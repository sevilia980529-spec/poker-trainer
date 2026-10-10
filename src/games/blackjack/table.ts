// 多人 21 点（Blackjack）牌桌状态层 v1
//
// 与单人引擎 engine.ts 的规则**完全一致**：
//   · 4 副牌靴、庄家所有 17 停牌（S17）、Blackjack 赔 3:2
//   · 双倍仅限首 2 张且非分 A 之后；分牌最多 4 手；分 A 各只补 1 张并立即完成
//   · 保险 ≤ 手牌注 / 2，赔 2:1（净赚 2 倍保险注）
// 点数/判定一律复用 engine.ts 导出的 handValue / isBlackjack / bjCardValue，消除行为漂移。
//
// 与 engine.ts 的差异（多人桌特有，均为刻意取舍）：
//   1. 庄家由 AI 玩家扮演（players[dealerIdx]），不再有单例 dealerHand；
//      dealerIdx 只用于座位标记与结算文案，庄家不参与下注，故不计入总注。
//   2. 每位玩家独立持筹，行动按座位顺序推进（从 dealerIdx+1 开始），一次只有一人可行动。
//   3. 筹码只在 bjTableSettle 一处结算（chips += 该玩家全部手牌净盈亏 + 保险净盈亏），
//      下注期间不扣筹码；加倍/分牌的合法性用「可动用筹码 = chips − 本手已投入」判定。
//   4. 随机数走注入的 rng（默认 Math.random），服务端权威化时可复现；本文件不直接调用 Math.random 洗牌。
//
// 纯逻辑层：零 React、零网络依赖，所有状态转移都是纯函数（返回新 state）。
import { handValue, isBlackjack, bjCardValue, type BjHand } from './engine';
import { createDeck, shuffle, type Card } from '../../engine/cards';
import { basicStrategyFull } from './strategy';

/** 分牌后最多 4 手（与 engine.ts canSplit 一致） */
export const BJ_MAX_SPLIT_HANDS = 4;

export type BjTablePhase = 'betting' | 'insurance' | 'player' | 'dealer' | 'settled';

export type BjTableAction = 'hit' | 'stand' | 'double' | 'split' | 'insurance' | 'declineInsurance';

export interface BjTablePlayer {
  id: number;
  seat: number;
  name: string;
  isAI: boolean;
  /** 筹码（余额）。下注期间不扣减，bjTableSettle 时统一结算 */
  hands: BjHand[];
  /** 当前操作的手牌索引 */
  activeHand: number;
  chips: number;
  insuranceBet: number;
  /** 保险净盈亏（2:1 中奖为 +2×注，未中为 −注） */
  insurancePayout?: number;
}

export interface BjTableState {
  shoe: Card[];
  players: BjTablePlayer[];
  /** 庄家座位（由 AI 扮演），仅用于座位标记 / 结算文案 */
  dealerIdx: number;
  /** 当前行动座位 */
  actingSeat: number;
  seenCards: Card[];
  phase: BjTablePhase;
  handNumber: number;
  message?: string;
  /** 本局基础注（每人每手） */
  bet: number;
  /** 单个玩家保险注上限（与 engine.ts bjInsurance 的 maxInsurance 同义） */
  maxInsurance: number;
  /**
   * 随机源。函数无法被 structuredClone，故不参与克隆（bjTableCloneState 单独处理）。
   * 序列化给客户端时必须剔除该字段。
   */
  rng: () => number;
}

export interface BjTablePlayerSpec {
  name: string;
  isAI: boolean;
  chips: number;
}

export interface BjTableOptions {
  players: BjTablePlayerSpec[];
  dealerIdx: number;
  /** 每人每手基础注，默认 100 */
  bet?: number;
  maxInsurance?: number;
  rng?: () => number;
}

export interface BjTableAdvice {
  action: BjTableAction;
  why: string;
}

// ---------------- 基础工具 ----------------

/** 4 副牌靴并洗牌；rng 由调用方注入，便于服务端权威化复现 */
export function newBjShoe(rng: () => number = Math.random): Card[] {
  const shoe: Card[] = [];
  for (let i = 0; i < 4; i++) shoe.push(...createDeck());
  return shuffle(shoe, rng);
}

/**
 * 纯函数克隆。
 * 不能直接 structuredClone(state)：rng 是函数，structuredClone 会抛 DataCloneError。
 * 这里先摘掉 rng 再克隆，随后原样挂回。
 */
export function bjTableCloneState(s: BjTableState): BjTableState {
  const { rng, ...data } = s;
  return { ...(structuredClone(data) as Omit<BjTableState, 'rng'>), rng };
}

/** 发一张牌：牌靴不足 52 张时重新洗靴（与 engine.ts draw 同策略），并计入 seenCards */
function draw(s: BjTableState): Card {
  if (s.shoe.length < 52) {
    s.shoe = newBjShoe(s.rng);
    s.seenCards = [];
  }
  const c = s.shoe.pop()!;
  s.seenCards.push(c);
  return c;
}

/** 庄家手牌 */
export function bjTableDealerHand(s: BjTableState): Card[] {
  return s.players[s.dealerIdx].hands[0].cards;
}

/** 庄家明牌 */
export function bjTableDealerUp(s: BjTableState): Card | undefined {
  return bjTableDealerHand(s)[0];
}

/** 庄家暗牌（仅结算后允许展示） */
export function bjTableHoleCard(s: BjTableState): Card | undefined {
  return bjTableDealerHand(s)[1];
}

/** 该玩家是否还有未判定的手牌 */
function hasUnresolvedHand(p: BjTablePlayer): boolean {
  return p.hands.some(h => h.result === undefined);
}

/** 该玩家是否已回答保险问题（买了保险，或已明确放弃） */
function hasAnsweredInsurance(p: BjTablePlayer): boolean {
  return p.insuranceBet > 0 || p.insurancePayout !== undefined;
}

/** 本手已投入筹码 = 各手注额 + 保险注 */
function committed(s: BjTableState, seat: number): number {
  const p = s.players[seat];
  return p.hands.reduce((sum, h) => sum + h.bet, 0) + p.insuranceBet;
}

/** 可动用筹码 = 余额 − 本手已投入（加倍/分牌/保险的合法性判定用） */
export function bjTableAvailableChips(s: BjTableState, seat: number): number {
  return s.players[seat].chips - committed(s, seat);
}

/** 从 dealerIdx+1 开始轮转的第一个有未完成手牌的玩家座位；没有则返回 -1 */
function nextUnresolvedSeat(s: BjTableState, fromSeat: number): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (fromSeat + k) % n;
    if (idx === s.dealerIdx) continue;
    const p = s.players[idx];
    if (!hasUnresolvedHand(p)) continue;
    if (p.hands.every(h => h.done)) continue;
    for (let i = 0; i < p.hands.length; i++) {
      if (!p.hands[i].done) { p.activeHand = i; return idx; }
    }
  }
  return -1;
}

/** 尚未回答保险问题的座位；没有则返回 -1 */
function nextInsuranceSeat(s: BjTableState, fromSeat: number): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (fromSeat + k) % n;
    if (idx === s.dealerIdx) continue;
    const p = s.players[idx];
    if (!hasAnsweredInsurance(p) && hasUnresolvedHand(p)) return idx;
  }
  return -1;
}

// ---------------- 建桌 / 发牌 ----------------

/**
 * 建桌并开始第 handNumber 手：发牌 + natural BJ 判定 + 决定进入保险还是玩家行动。
 * 庄家由 AI 扮演，同样发 2 张（第 1 张为明牌）。
 */
export function newBjTable(opts: BjTableOptions): BjTableState {
  const rng = opts.rng ?? Math.random;
  const bet = opts.bet ?? 100;
  const maxInsurance = opts.maxInsurance ?? Infinity;
  const players: BjTablePlayer[] = opts.players.map((spec, seat) => ({
    id: seat,
    seat,
    name: spec.name,
    isAI: spec.isAI,
    hands: [{ cards: [], bet, done: false, fromSplitAces: false }],
    activeHand: 0,
    chips: spec.chips,
    insuranceBet: 0,
  }));
  const s: BjTableState = {
    shoe: newBjShoe(rng),
    players,
    dealerIdx: opts.dealerIdx,
    actingSeat: -1,
    seenCards: [],
    phase: 'betting',
    handNumber: 1,
    bet,
    maxInsurance,
    rng,
  };
  return dealHand(s);
}

/** 同一桌开下一手（递增 handNumber，重新发牌；沿用现有 rng 与筹码） */
export function bjTableStartHand(s0: BjTableState): BjTableState {
  const s = bjTableCloneState(s0);
  s.handNumber += 1;
  s.message = undefined;
  s.phase = 'betting';
  s.actingSeat = -1;
  s.seenCards = [];
  s.players.forEach(p => {
    p.hands = [{ cards: [], bet: s.bet, done: false, fromSplitAces: false }];
    p.activeHand = 0;
    p.insuranceBet = 0;
    p.insurancePayout = undefined;
  });
  return dealHand(s);
}

/** 发牌 + natural BJ 判定 + 阶段流转（就地修改 s） */
function dealHand(s: BjTableState): BjTableState {
  // 发牌顺序：从庄家左手第一位开始，按座位轮转发牌（与 engine.ts 一次发两张一致）
  const n = s.players.length;
  for (let k = 1; k < n; k++) {
    const seat = (s.dealerIdx + k) % n;
    const h = s.players[seat].hands[0];
    h.cards.push(draw(s), draw(s));
  }
  // 庄家 2 张：第 1 张明牌、第 2 张暗牌
  const dealerHand = s.players[s.dealerIdx].hands[0];
  dealerHand.cards.push(draw(s), draw(s));

  const dBJ = isBlackjack(dealerHand.cards);

  // natural BJ 立即判定（3:2；遇庄家 BJ 则平局）
  for (let k = 1; k < n; k++) {
    const seat = (s.dealerIdx + k) % n;
    const h = s.players[seat].hands[0];
    if (!isBlackjack(h.cards)) continue;
    h.done = true;
    if (dBJ) {
      h.result = 'push';
      h.payout = 0;
    } else {
      h.result = 'win';
      h.payout = Math.floor(h.bet * 1.5);
    }
  }

  const firstSeat = nextUnresolvedSeat(s, s.dealerIdx);
  const anyPending = firstSeat !== -1;
  const dealerUpAce = dealerHand.cards[0].rank === 14;

  // 庄家明牌 A 且仍有未结算玩家 → 先问保险（已 BJ 的玩家不参与）
  if (dealerUpAce && anyPending) {
    s.phase = 'insurance';
    const insSeat = nextInsuranceSeat(s, s.dealerIdx);
    s.actingSeat = insSeat;
    s.message = '庄家明牌是 A：可选择保险（赔 2:1）';
    return s;
  }

  // 无人可行动（全员 natural BJ）或庄家已是 BJ → 直接结算
  if (!anyPending || dBJ) return bjTableSettle(s);

  s.phase = 'player';
  s.actingSeat = firstSeat;
  return s;
}

// ---------------- 合法性 ----------------

/** 当前手牌能否分牌（点数相同、最多 4 手、未完成） */
export function bjTableCanSplit(s: BjTableState, seat: number): boolean {
  if (s.phase !== 'player' || s.actingSeat !== seat) return false;
  const p = s.players[seat];
  if (p.hands.length >= BJ_MAX_SPLIT_HANDS) return false;
  const h = p.hands[p.activeHand];
  if (h.done || h.cards.length !== 2) return false;
  return bjCardValue(h.cards[0]) === bjCardValue(h.cards[1]);
}

/**
 * 指定座位的合法动作。
 * 与 engine.ts legalBjActions 的区别：**没有 playerPoints 参数**——加倍/分牌是否合法
 * 一律读 s.players[seat].chips（通过 bjTableAvailableChips），规则层不再泄漏 UI 积分。
 */
export function bjTableLegalActions(s: BjTableState, seat: number): BjTableAction[] {
  if (seat < 0 || seat >= s.players.length) return [];
  const p = s.players[seat];
  if (s.phase === 'insurance') {
    if (s.actingSeat !== seat) return [];
    if (p.insuranceBet > 0 || p.insurancePayout !== undefined) return [];   // 已回答过
    if (!hasUnresolvedHand(p)) return [];                                  // 已结算，不再询问
    return ['insurance', 'declineInsurance'];
  }
  if (s.phase !== 'player' || s.actingSeat !== seat) return [];
  const h = p.hands[p.activeHand];
  if (h.done) return [];
  const acts: BjTableAction[] = ['hit', 'stand'];
  const avail = bjTableAvailableChips(s, seat);
  if (h.cards.length === 2 && !h.fromSplitAces && avail >= h.bet) acts.push('double');
  if (bjTableCanSplit(s, seat) && avail >= h.bet) acts.push('split');
  return acts;
}

// ---------------- 玩家行动 ----------------

/**
 * 纯函数执行一次动作。
 * 只有 s.actingSeat === seat 时生效（非法调用原样返回，不抛错，便于服务端容错）。
 */
export function bjTableApply(s0: BjTableState, seat: number, action: BjTableAction): BjTableState {
  const s = bjTableCloneState(s0);
  if (seat < 0 || seat >= s.players.length || s.actingSeat !== seat) return s;

  if (s.phase === 'insurance') {
    if (action !== 'insurance' && action !== 'declineInsurance') return s;
    return applyInsurance(s, seat, action === 'insurance');
  }
  if (s.phase !== 'player') return s;
  if (!bjTableLegalActions(s, seat).includes(action)) return s;

  const p = s.players[seat];
  const h = p.hands[p.activeHand];

  switch (action) {
    case 'hit': {
      h.cards.push(draw(s));
      const v = handValue(h.cards);
      if (v.value > 21) { h.done = true; h.result = 'bust'; h.payout = -h.bet; }
      else if (v.value === 21) h.done = true;
      return advanceSeat(s);
    }
    case 'double': {
      h.bet *= 2;
      h.cards.push(draw(s));
      const v = handValue(h.cards);
      h.done = true;                                  // 加倍后只补 1 张并立即完成
      if (v.value > 21) { h.result = 'bust'; h.payout = -h.bet; }
      return advanceSeat(s);
    }
    case 'split': {
      if (!bjTableCanSplit(s, seat)) return s;
      const isAces = h.cards[0].rank === 14;
      const c1 = h.cards[0], c2 = h.cards[1];
      const newHands: BjHand[] = [
        { cards: [c1, draw(s)], bet: h.bet, done: false, fromSplitAces: isAces },
        { cards: [c2, draw(s)], bet: h.bet, done: false, fromSplitAces: isAces },
      ];
      p.hands.splice(p.activeHand, 1, ...newHands);
      if (isAces) {
        // 分 A 规则：各只补 1 张，直接完成（与 engine.ts 一致）
        newHands.forEach(nh => { nh.done = true; });
        return advanceSeat(s);
      }
      return s;   // 非分 A：仍从新生成的第一手（splice 后的原 activeHand 位）继续
    }
    case 'stand':
    default: {
      h.done = true;
      return advanceSeat(s);
    }
  }
}

/** 处理保险决策 */
function applyInsurance(s: BjTableState, seat: number, take: boolean): BjTableState {
  const p = s.players[seat];
  if (take) {
    // 保险 ≤ 手牌注 / 2（与 engine.ts 一致），同时受 maxInsurance 与可动用筹码限制
    const amount = Math.min(Math.floor(p.hands[0].bet / 2), s.maxInsurance, bjTableAvailableChips(s, seat));
    p.insuranceBet = Math.max(0, amount);
    // 筹码不足导致实际注额为 0 时，同样要把该座位标记为已回答
    if (p.insuranceBet === 0) p.insurancePayout = 0;
  } else {
    p.insuranceBet = 0;
    // 明确置 0：既表示「放弃保险净盈亏为 0」，也把该座位标记为已回答，避免被重复询问
    p.insurancePayout = 0;
  }
  const next = nextInsuranceSeat(s, seat);
  if (next !== -1) {
    s.actingSeat = next;
    return s;
  }
  // 全部回答完毕：庄家若是 BJ 则本局结束，否则回到玩家行动
  if (isBlackjack(bjTableDealerHand(s))) return bjTableSettle(s);
  const first = nextUnresolvedSeat(s, s.dealerIdx);
  if (first === -1) return bjTableSettle(s);
  s.phase = 'player';
  s.actingSeat = first;
  s.message = take ? '保险已下注，继续主注' : '放弃保险，继续主注';
  return s;
}

/** 行动推进：当前玩家下一手 → 下一玩家 → 全员完成则进入庄家阶段 */
function advanceSeat(s: BjTableState): BjTableState {
  const me = s.players[s.actingSeat];
  for (let i = me.activeHand; i < me.hands.length; i++) {
    if (!me.hands[i].done) { me.activeHand = i; return s; }
  }
  const next = nextUnresolvedSeat(s, s.actingSeat);
  if (next !== -1) {
    s.actingSeat = next;
    return s;
  }
  // 全员完成（含全部爆牌）：全场都爆牌时庄家不必动作，直接结算（与 engine.ts nextHand 一致）
  const allBust = s.players.every((p, i) =>
    i === s.dealerIdx || p.hands.every(h => h.result === 'bust'),
  );
  if (allBust) {
    return bjTableSettle(s);
  }
  s.phase = 'dealer';
  s.actingSeat = s.dealerIdx;
  return s;
}

// ---------------- 庄家（AI）与结算 ----------------

/** AI 庄家：S17 —— 17 点以下继续要牌（含软 17） */
export function bjDealerPlay(s0: BjTableState): BjTableState {
  const s = bjTableCloneState(s0);
  if (s.phase !== 'dealer') return s;
  s.phase = 'dealer';
  const hand = bjTableDealerHand(s);
  while (handValue(hand).value < 17) hand.push(draw(s));
  return bjTableSettle(s);
}

/**
 * 结算：把每位玩家各手净盈亏 + 保险净盈亏一次性写回 chips。
 * 幂等——已结算的 state 直接返回（不会重复加钱）。
 */
export function bjTableSettle(s0: BjTableState): BjTableState {
  const s = bjTableCloneState(s0);
  if (s.phase === 'settled') return s;

  const dealerCards = bjTableDealerHand(s);
  const dBJ = isBlackjack(dealerCards);
  const d = handValue(dealerCards).value;

  const parts: string[] = [];
  // 是否全场都是爆牌（用于结算文案；若有非爆牌手牌则为 false）
  let anySurvivor = false;

  for (let k = 1; k <= s.players.length; k++) {
    const seat = (s.dealerIdx + k) % s.players.length;
    if (seat === s.dealerIdx) continue;
    const p = s.players[seat];
    let net = 0;

    p.hands.forEach((h, i) => {
      if (h.result !== undefined) {
        // 已在流程中判定（natural BJ / 爆牌 / 分 A 前的显式结果）
        net += h.payout ?? 0;
        if (h.result !== 'bust') anySurvivor = true;
        parts.push(`${p.name} 第${i + 1}手${bjResultLabel(h.result)}`);
        return;
      }
      const hv = handValue(h.cards).value;
      let result: 'win' | 'lose' | 'push' | 'bust';
      if (dBJ) {
        result = 'lose';                              // 庄家 Blackjack → 主注全输（保险另算）
      } else if (hv > 21) {
        result = 'bust';
      } else if (d > 21 || hv > d) {
        result = 'win';
      } else if (hv < d) {
        result = 'lose';
      } else {
        result = 'push';
      }
      h.result = result;
      h.payout = result === 'win' ? h.bet : (result === 'lose' || result === 'bust') ? -h.bet : 0;
      h.done = true;
      net += h.payout;
      if (result !== 'bust') anySurvivor = true;
      parts.push(`${p.name} 第${i + 1}手 ${bjResultLabel(result)}`);
    });

    // 保险 2:1：庄家 BJ 则净赚 2×注，否则损失注额
    if (p.insuranceBet > 0) {
      p.insurancePayout = dBJ ? p.insuranceBet * 2 : -p.insuranceBet;
      net += p.insurancePayout;
      parts.push(`${p.name} 保险${dBJ ? `赢 ${p.insurancePayout}` : `输 ${-p.insurancePayout}`}`);
    } else if (p.insurancePayout === undefined) {
      p.insurancePayout = 0;
    }

    p.chips += net;
  }

  const dLabel = dBJ ? '庄家 Blackjack' : d > 21 ? `庄家爆牌（${d}点）` : `庄家 ${d} 点`;
  s.phase = 'settled';
  s.actingSeat = s.dealerIdx;
  s.message = `${anySurvivor ? dLabel + '。' : '全部爆牌。'}${parts.join('；')}`;
  return s;
}

function bjResultLabel(r: 'win' | 'lose' | 'push' | 'bust'): string {
  return r === 'win' ? '赢' : r === 'lose' ? '负' : r === 'bust' ? '爆牌' : '平';
}

// ---------------- 汇总 ----------------

/**
 * 全桌总投入（含分牌/双倍/保险，不含庄家）。
 * 与 engine.ts totalBet 的唯一差异：这里把保险注也计入，
 * 以便与 bjTableTotalPayout（含保险）保持同一口径、直接算 RTP。
 */
export function bjTableTotalBet(s: BjTableState): number {
  return s.players.reduce((sum, p) => {
    if (p.seat === s.dealerIdx) return sum;
    return sum + p.hands.reduce((n, h) => n + h.bet, 0) + p.insuranceBet;
  }, 0);
}

/** 全桌总净盈亏（含保险；engine.ts totalPayout 不含保险，这里补上以便对账） */
export function bjTableTotalPayout(s: BjTableState): number {
  return s.players.reduce((sum, p) => {
    if (p.seat === s.dealerIdx) return sum;
    return sum + p.hands.reduce((n, h) => n + (h.payout ?? 0), 0) + (p.insurancePayout ?? 0);
  }, 0);
}

/** 单个玩家的净盈亏（含保险） */
export function bjTablePlayerPayout(s: BjTableState, seat: number): number {
  const p = s.players[seat];
  return p.hands.reduce((n, h) => n + (h.payout ?? 0), 0) + (p.insurancePayout ?? 0);
}

// ---------------- AI 决策 ----------------

/**
 * 用 strategy.ts 的基本策略给指定座位一个推荐动作（仅供 UI 提示 / AI 自动打牌）。
 * 返回 null 表示该座位当前无需行动。
 */
export function bjTableAdvice(s: BjTableState, seat: number): BjTableAdvice | null {
  if (seat < 0 || seat >= s.players.length) return null;
  if (s.phase === 'insurance') {
    return { action: 'declineInsurance', why: '基本策略原则：永远不买保险（10 点牌约 30.8% < 赔率要求的 33.3%）。' };
  }
  if (s.phase !== 'player' || s.actingSeat !== seat) return null;
  const p = s.players[seat];
  const h = p.hands[p.activeHand];
  const up = bjTableDealerUp(s);
  if (!up) return null;
  const adv = basicStrategyFull(h.cards, up, bjTableCanSplit(s, seat));
  return { action: adv.action as BjTableAction, why: adv.why };
}

/** AI 自动打牌：按基本策略替某个座位行动一次（测试与机器人对手共用） */
export function bjTableAutoApply(s: BjTableState, seat: number): BjTableState {
  const legal = bjTableLegalActions(s, seat);
  if (legal.length === 0) return s;
  const adv = bjTableAdvice(s, seat);
  let action = adv?.action ?? 'stand';
  if (!legal.includes(action)) {
    // 基本策略可能建议 double/split 但筹码不足 → 退化为最优合法动作
    action = legal.includes('stand') ? 'stand' : legal[0];
  }
  return bjTableApply(s, seat, action);
}

// ---------------- 服务端线协议脱敏 ----------------

/**
 * 服务端下发给客户端的脱敏拷贝（纯函数，不依赖 ws，方便单测）。
 *
 * 信息泄漏点必须剔除：`shoe`（整靴牌）、`seenCards`（已发过的牌）、`rng`（函数）。
 * 牌面隐藏规则（客户端依赖的线协议契约）：
 *   · phase === 'settled'：整体可见（保留所有 hands 的 cards），仍删 shoe/seenCards/rng。
 *   · 否则（未结算）：对每个座位 i：
 *       - i === viewerSeat：保留其全部 hands（全部牌可见）。
 *       - i === dealerIdx：庄家第一手第一张（明牌）保留，其余庄家牌清空（只留 cards[0]）。
 *       - 其它：该玩家每个 hands[].cards 全部替换为 []（隐藏）。
 *   保留 chips / insuranceBet / insurancePayout / result / payout / activeHand /
 *   isAI / name / seat / id / bet / done 等 UI/计分字段，只隐藏原始牌数组。
 *
 * 返回新对象，绝不 mutate 入参（先摘 rng 再 structuredClone 再挂回 no-op）。
 */
export function bjSanitizeState(state: BjTableState, viewerSeat: number): BjTableState {
  // 先摘 rng：structuredClone 无法克隆函数字段（rng 是函数，必须剔除）
  const data: Record<string, any> = { ...state };
  delete data.rng;
  const clone = structuredClone(data) as Record<string, any>;
  // 剔除信息泄漏字段（shoe / seenCards 不通过 WS 发送）
  delete clone.shoe;
  delete clone.seenCards;
  // rng 类型必填，挂回 no-op（客户端不会调用）
  clone.rng = () => 0;

  const phase: BjTablePhase = clone.phase;
  if (phase !== 'settled') {
    const dealerIdx: number = clone.dealerIdx;
    for (let i = 0; i < clone.players.length; i++) {
      if (i === viewerSeat) continue; // 自己的手牌全可见
      const p = clone.players[i];
      if (i === dealerIdx) {
        // 庄家：明牌（第一手第一张）保留，其余牌隐藏
        p.hands = p.hands.map((h: any, hi: number) =>
          hi === 0
            ? { ...h, cards: h.cards && h.cards.length > 0 ? [h.cards[0]] : [] }
            : { ...h, cards: [] },
        );
      } else {
        p.hands = p.hands.map((h: any) => ({ ...h, cards: [] }));
      }
    }
  }
  return clone as BjTableState;
}
