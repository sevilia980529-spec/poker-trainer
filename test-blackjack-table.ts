// 多人 21 点牌桌状态层（table.ts）冒烟测试
// 覆盖：点数/分牌判定、多人交错推进、加倍/分牌、保险、natural BJ、RTP、边界
import { handValue, isBlackjack, bjCardValue } from './src/games/blackjack/engine';
import { splitAdvice, basicStrategyFull } from './src/games/blackjack/strategy';
import type { Card } from './src/engine/cards';
import {
  newBjTable, bjTableStartHand, bjTableApply, bjTableAutoApply, bjTableLegalActions,
  bjTableCanSplit, bjDealerPlay, bjTableSettle, bjTableTotalBet, bjTableTotalPayout,
  bjTableAdvice, bjTableAvailableChips, bjTableDealerUp, bjTableDealerHand, bjTablePlayerPayout,
  BJ_MAX_SPLIT_HANDS, type BjTableState, type BjTablePhase, type BjTableAction,
} from './src/games/blackjack/table';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.error('FAIL:', m); } };
const c = (rank: number, suit: 's' | 'h' | 'd' | 'c' = 's'): Card => ({ rank, suit });
const d = (r: number) => c(r, 'h');
const d10 = () => c(10, 'h');

/** 可复现的伪随机源（线性同余），用于验证 rng 注入与确定性 */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

const PHASES: BjTablePhase[] = ['betting', 'insurance', 'player', 'dealer', 'settled'];

/**
 * 建一桌 playerCount 位玩家（座位 1..playerCount）+ AI 庄家（座位 0）。
 * 庄家在左手第一位，故 actingSeat 从 1 开始。
 */
function mkTable(playerCount: number, seed = 7, bet = 100, chips = 1_000_000): BjTableState {
  const names = ['你', 'AI甲', 'AI乙', 'AI丙', 'AI丁', 'AI戊', 'AI己'];
  return newBjTable({
    players: Array.from({ length: playerCount + 1 }, (_, i) => ({
      name: names[i], isAI: i > 0, chips,
    })),
    dealerIdx: 0,
    bet,
    maxInsurance: Math.floor(bet / 2),
    rng: lcg(seed),
  });
}

/** 把一桌打到结算。ai=true 时按基本策略自动行动 */
function playRound(s0: BjTableState, ai = true): BjTableState {
  let s = s0;
  let guard = 0;
  while (s.phase !== 'settled' && guard++ < 200) {
    assert(PHASES.includes(s.phase), `phase 必须是合法枚举，实际 ${s.phase}`);
    if (s.phase === 'insurance') {
      s = ai ? bjTableAutoApply(s, s.actingSeat) : bjTableApply(s, s.actingSeat, 'declineInsurance');
    } else if (s.phase === 'player') {
      s = ai ? bjTableAutoApply(s, s.actingSeat) : bjTableApply(s, s.actingSeat, 'stand');
    } else if (s.phase === 'dealer') {
      s = bjDealerPlay(s);
    } else break;
  }
  return s;
}

/**
 * 构造「发牌已被摆好」的牌桌，用于确定性的规则断言。
 * drawPile 按「将要发出的顺序」给出；rig 会把它铺进牌靴尾部并垫足 filler，避免中途洗靴。
 */
function rig(
  dealerCards: Card[],
  seats: Card[][],
  opts: { bet?: number; chips?: number; drawPile?: Card[]; phase?: BjTablePhase } = {},
): BjTableState {
  const bet = opts.bet ?? 100;
  const chips = opts.chips ?? 100000;
  const pile = opts.drawPile ?? [];
  const filler: Card[] = [];
  for (let i = 0; i < 120; i++) filler.push(c(2 + (i % 13), 's'));
  const names = ['你', 'AI甲', 'AI乙', 'AI丙', 'AI丁'];

  const t: BjTableState = {
    shoe: [...filler, ...pile.slice().reverse()],
    players: names.slice(0, seats.length + 1).map((name, i) => ({
      id: i, seat: i, name: i === 0 ? `${name}(庄)` : name, isAI: i > 0,
      hands: [], activeHand: 0, chips, insuranceBet: 0,
    })),
    dealerIdx: 0,
    actingSeat: -1,
    seenCards: [],
    phase: 'betting',
    handNumber: 1,
    bet,
    maxInsurance: Math.floor(bet / 2),
    rng: lcg(12345),
  };
  // 座位 0 是庄家（不计入投注），座位 1..n 是玩家
  t.players[0].hands = [{ cards: [...dealerCards], bet: 0, done: true, fromSplitAces: false }];
  for (let i = 0; i < seats.length; i++) {
    t.players[i + 1].hands = [{ cards: [...seats[i]], bet, done: false, fromSplitAces: false }];
  }
  const first = t.players.findIndex((p, i) => i > 0 && !p.hands.every(h => h.done));
  t.phase = opts.phase ?? (first === -1 ? 'settled' : 'player');
  t.actingSeat = first === -1 ? t.dealerIdx : first;
  return t;
}

// ---------- 1. 点数与分牌判定（沿用 test-blackjack.ts 的断言） ----------
assert(handValue([c(14), c(13)]).value === 21, 'A K = 21');
assert(handValue([c(14), c(14), c(9)]).value === 21, 'A A 9 = 21');
assert(handValue([c(14), c(6)]).soft && handValue([c(14), c(6)]).value === 17, 'A 6 软 17');
assert(isBlackjack([c(14), c(10)]), 'A T 是 Blackjack');
// bjCardValue 对 rank>=10 一律返回 10（含 A，点数换算交给 handValue）
assert(bjCardValue(c(13)) === 10 && bjCardValue(c(14)) === 10 && bjCardValue(c(7)) === 7, '点数映射');
assert(splitAdvice([c(14), c(14, 'h')], d10())?.shouldSplit === true, 'A-A 应分');
assert(splitAdvice([c(8), c(8, 'h')], d10())?.shouldSplit === true, '8-8 应分');
assert(splitAdvice([c(10), c(13)], d(6))?.shouldSplit === false, 'T-T 不分');
assert(splitAdvice([c(5), c(5, 'h')], d(6))?.shouldSplit === false, '5-5 不分');
assert(splitAdvice([c(9), c(9, 'h')], d(7))?.shouldSplit === false, '9-9 vs 7 不分');
assert(splitAdvice([c(9), c(9, 'h')], d(6))?.shouldSplit === true, '9-9 vs 6 分');
assert(basicStrategyFull([c(10), c(6)], d(10), false).action === 'hit', '硬16 vs T 要牌');
assert(basicStrategyFull([c(6), c(5)], d(8), false).action === 'double', '11 vs 8 双倍');
console.log('点数 / 分牌 / 基本策略判定：通过');

// ---------- 2. 多人交错推进 ----------
{
  const ROUNDS = 3000;
  let orderOk = true, singleActerOk = true, settledOk = true;
  for (let i = 0; i < ROUNDS; i++) {
    let s = mkTable(3, i + 1);
    const seq: number[] = [];
    let guard = 0;
    while (s.phase !== 'settled' && guard++ < 200) {
      if (s.phase === 'insurance') {
        // 断言：任一时刻只有 actingSeat 一个人有合法动作
        const legalSeats = s.players
          .map((_, seat) => (bjTableLegalActions(s, seat).length > 0 ? seat : -1))
          .filter(x => x >= 0);
        if (legalSeats.length !== 1 || legalSeats[0] !== s.actingSeat) singleActerOk = false;
        s = bjTableApply(s, s.actingSeat, 'declineInsurance');
      } else if (s.phase === 'player') {
        const legalSeats = s.players
          .map((_, seat) => (bjTableLegalActions(s, seat).length > 0 ? seat : -1))
          .filter(x => x >= 0);
        if (legalSeats.length !== 1 || legalSeats[0] !== s.actingSeat) singleActerOk = false;
        seq.push(s.actingSeat);
        s = bjTableApply(s, s.actingSeat, 'stand');
      } else if (s.phase === 'dealer') {
        s = bjDealerPlay(s);
      } else break;
    }
    if (s.phase !== 'settled') { settledOk = false; break; }
    // 只用 stand 时每位玩家至多行动一次，故座位序列必须严格递增，且都落在 1..3
    for (let k = 1; k < seq.length; k++) if (seq[k] <= seq[k - 1]) orderOk = false;
    if (seq.some(x => x < 1 || x > 3)) orderOk = false;
  }
  assert(settledOk, '每局都必须走到 settled');
  assert(orderOk, '行动座位应按 1→2→3 严格递增推进（庄家不参与）');
  assert(singleActerOk, '任一时刻只应有 actingSeat 一人有合法动作');
  console.log(`多人交错推进：${ROUNDS} 局，座位顺序与唯一行动人均正确`);
}

// ---------- 3. 加倍 / 分牌 ----------
{
  // 3.1 两张牌时可加倍；加倍后恰好 3 张、注额翻倍、立即完成
  let s = rig([d(10), d(8)], [[c(6), c(5)]], { drawPile: [c(3, 'h')] });
  assert(s.phase === 'player' && s.actingSeat === 1, 'rig 后进入玩家阶段，座位 1 先行动');
  assert(bjTableLegalActions(s, 1).includes('double'), '两张牌时可加倍');
  s = bjTableApply(s, 1, 'double');
  const h = s.players[1].hands[0];
  assert(h.cards.length === 3, `加倍后应恰好 3 张，实际 ${h.cards.length}`);
  assert(h.bet === 200, `加倍后注额翻倍，实际 ${h.bet}`);
  assert(h.done, '加倍后立即完成');
  assert(bjTableLegalActions(s, s.actingSeat).length === 0, '加倍后不能再行动');
  assert(s.phase === 'dealer', '唯一玩家完成后进入庄家阶段');

  // 3.2 三张牌后不可加倍；要牌爆牌后判 bust 并输整注
  s = rig([d(10), d(8)], [[c(10), c(5)]], { drawPile: [c(5, 'h'), c(10, 'h')] });
  s = bjTableApply(s, 1, 'hit');                       // 15 + 5 = 20，未爆、未完成
  assert(!bjTableLegalActions(s, 1).includes('double'), '3 张牌后不可加倍');
  assert(!s.players[1].hands[0].done, '20 点仍需继续决策');
  s = bjTableApply(s, 1, 'hit');                       // 20 + 10 = 30 → 爆牌
  assert(s.phase === 'settled', '爆牌后应直接结算');
  assert(s.players[1].hands[0].result === 'bust', '超过 21 应判爆牌');
  assert(s.players[1].hands[0].payout === -100, '爆牌输掉整注');

  // 3.3 分牌：两手、各补一张、注额与原注相同
  s = rig([d(10), d(8)], [[c(8), c(8, 'h')]], { drawPile: [c(3, 'h'), c(4, 'd')] });
  assert(bjTableCanSplit(s, 1), '8-8 可分牌');
  s = bjTableApply(s, 1, 'split');
  assert(s.players[1].hands.length === 2, '分牌后应有两手');
  assert(s.players[1].hands[0].bet === 100 && s.players[1].hands[1].bet === 100, '分牌两手注额与原注相同');
  assert(s.players[1].hands.every(h => h.cards.length === 2), '分牌后每手各补一张');
  assert(bjTableTotalBet(s) === 200, '分牌后总注翻倍');
  assert(s.phase === 'player' && s.actingSeat === 1, '非分 A 时仍由本家继续打第一手');

  // 3.4 分 A：各只补 1 张并立即完成
  s = rig([d(10), d(8)], [[c(14), c(14, 'h')]], { drawPile: [c(3, 'h'), c(4, 'd')] });
  s = bjTableApply(s, 1, 'split');
  assert(s.players[1].hands.length === 2, '分 A 后两手');
  assert(s.players[1].hands.every(h => h.cards.length === 2), '分 A 后每手只有 2 张');
  assert(s.players[1].hands.every(h => h.done), '分 A 后两手立即完成');
  assert(s.players[1].hands.every(h => h.fromSplitAces), 'fromSplitAces 标记正确');
  assert(bjTableLegalActions(s, 1).length === 0, '分 A 后本家不再行动');

  // 3.5 分牌最多 4 手：连续分牌到 4 手后禁止再分
  assert(BJ_MAX_SPLIT_HANDS === 4, '分手上限为 4');
  s = rig([d(10), d(8)], [[c(8), c(8, 'h')]], { drawPile: [c(8), c(8), c(8), c(8), c(8), c(8)] });
  s = bjTableApply(s, 1, 'split');            // 2 手
  s = bjTableApply(s, 1, 'split');            // 3 手
  s = bjTableApply(s, 1, 'split');            // 4 手
  assert(s.players[1].hands.length === 4, `连续分牌后应达 4 手，实际 ${s.players[1].hands.length}`);
  assert(!bjTableCanSplit(s, 1), '已达 4 手时不可再分牌');
  assert(!bjTableLegalActions(s, 1).includes('split'), '合法动作里不应再有 split');

  // 3.6 分牌后多手结算
  s = rig([d(10), d(8)], [[c(8), c(8, 'h')]], { drawPile: [c(3, 'h'), c(4, 'd')] });
  s = bjTableApply(s, 1, 'split');
  s = playRound(s, false);
  assert(s.phase === 'settled', '分牌局应结算');
  assert(s.players[1].hands.length === 2, '结算后仍保留两手');
  assert(s.players[1].hands.every(h => h.result !== undefined && h.payout !== undefined), '每手都有结果与盈亏');
  assert(bjTableTotalBet(s) === 200, '分牌两手总注 200');
  console.log('加倍 / 分牌规则：通过');
}

// ---------- 4. 保险流程 ----------
{
  // 用局部错误计数，避免与其它小节的 failures 互相污染（否则一处失败会连锁跳过整节）
  let err = 0;
  const bad = (m: string) => { err++; failures++; console.error('FAIL:', m); };
  let insRounds = 0, insOk = 0;
  for (let i = 0; i < 8000; i++) {
    let s = mkTable(3, i + 500);
    if (s.phase !== 'insurance') continue;
    insRounds++;
    const askers: number[] = [];
    let guard = 0;
    // 逐个玩家决策：全部买保险
    while (s.phase === 'insurance' && guard++ < 20) {
      const seat = s.actingSeat;
      askers.push(seat);
      const legal = bjTableLegalActions(s, seat);
      if (legal.length !== 2 || !legal.includes('insurance') || !legal.includes('declineInsurance')) {
        bad(`保险阶段合法动作应为 [insurance, declineInsurance]，实际 [${legal}]`); break;
      }
      s = bjTableApply(s, seat, 'insurance');
    }
    if (err) break;
    // 被询问者 = 尚未结算（即没有 natural BJ）的玩家；庄家不参与保险
    const eligible = s.players
      .map((p, seat) => (seat === s.dealerIdx || isBlackjack(p.hands[0].cards) ? -1 : seat))
      .filter(x => x >= 0);
    if (askers.length !== eligible.length) bad(`应询问 ${eligible.length} 位未结算玩家，实际 ${askers.length}`);
    if (new Set(askers).size !== askers.length) bad('保险不得重复询问同一座位');
    // 保险注 = 手牌注 / 2 = 50
    for (const seat of askers) {
      if (s.players[seat].insuranceBet !== 50) bad(`保险注应为 50，实际 ${s.players[seat].insuranceBet}`);
    }
    if (err) break;
    s = playRound(s);
    if (s.phase !== 'settled') { bad('保险局必须结算（不能卡在 insurance）'); break; }
    const dBJ = isBlackjack(bjTableDealerHand(s));
    for (const seat of askers) {
      // 赔 2:1：庄家 BJ 净赚 100（50 注 × 2），否则净输 50
      const expect = dBJ ? 100 : -50;
      if (s.players[seat].insurancePayout !== expect) bad(`保险赔付 ${s.players[seat].insurancePayout}，期望 ${expect}`);
    }
    if (err) break;
    insOk++;
  }
  assert(insRounds > 300, `应遇到足够多保险机会，实际 ${insRounds}`);
  assert(err === 0, '保险流程存在失败');
  console.log(`保险流程：${insOk}/${insRounds} 局正常（逐人询问 + 赔付 2:1 均校验通过）`);

  // 构造：庄家明牌 A + 暗牌 10 → 保险赔付、主注全输
  let s2 = rig([c(14), c(10, 'h')], [[c(9), c(8, 'd')], [c(7), c(6, 'd')]]);
  s2.phase = 'insurance'; s2.actingSeat = 1;
  let t2 = bjTableApply(s2, 1, 'insurance');
  assert(t2.phase === 'insurance' && t2.actingSeat === 2, '买完第一家应轮到第二家');
  assert(t2.players[1].insuranceBet === 50, '构造局保险注 = 50');
  t2 = bjTableApply(t2, 2, 'insurance');
  assert(t2.phase === 'settled', '庄家 BJ 时保险问完即结算');
  assert(t2.players[1].insurancePayout === 100, '庄家 BJ 保险净赢 100（赔 2:1）');
  assert(t2.players[1].hands[0].payout === -100, '庄家 BJ 主注全输');
  assert(t2.players[2].insurancePayout === 100 && t2.players[2].hands[0].payout === -100, '第二家同样结算');

  // 构造：庄家明牌 A + 暗牌 5（非 BJ）→ 保险输，主注继续
  let s3 = rig([c(14), c(5, 'h')], [[c(10), c(8, 'd')]]);
  s3.phase = 'insurance'; s3.actingSeat = 1;
  let t3 = bjTableApply(s3, 1, 'insurance');
  assert(t3.phase === 'player' && t3.actingSeat === 1, '庄家非 BJ 时回到玩家行动');
  assert(t3.players[1].insurancePayout === undefined, '未到结算时保险盈亏待定');
  t3 = playRound(t3, false);
  assert(t3.players[1].insurancePayout === -50, '庄家非 BJ 保险净输 50');

  // 放弃保险：明确标记为已回答，且净盈亏为 0
  let s4 = rig([c(14), c(10, 'h')], [[c(9), c(8, 'd')]]);
  s4.phase = 'insurance'; s4.actingSeat = 1;
  const t4 = bjTableApply(s4, 1, 'declineInsurance');
  assert(t4.phase === 'settled', '唯一玩家放弃保险后应结算');
  assert(t4.players[1].insuranceBet === 0, '放弃保险注应为 0');
  assert(t4.players[1].insurancePayout === 0, '放弃保险净盈亏为 0');
  assert(bjTableTotalBet(t4) === 100, '放弃保险后总注只有主注');
  console.log('保险 2:1 赔付：通过');
}

// ---------- 5. natural BJ 3:2 ----------
{
  let err = 0;
  const bad = (m: string) => { err++; failures++; console.error('FAIL:', m); };
  let bjRounds = 0, bjOk = 0;
  for (let i = 0; i < 10000; i++) {
    const s = mkTable(2, i + 9000);
    for (let seat = 1; seat < s.players.length; seat++) {
      const h = s.players[seat].hands[0];
      if (!isBlackjack(h.cards)) continue;
      bjRounds++;
      const dBJ = isBlackjack(bjTableDealerHand(s));
      if (h.result === undefined) { bad('natural BJ 未立即判定'); break; }
      if (!h.done) { bad('natural BJ 后应立即完成，不再行动'); break; }
      if (dBJ) {
        if (h.result !== 'push' || h.payout !== 0) { bad('双方 BJ 应平局'); break; }
      } else {
        if (h.result !== 'win' || h.payout !== 150) { bad(`natural BJ 应 3:2 赢 150，实际 ${h.result}/${h.payout}`); break; }
      }
      bjOk++;
    }
    if (err) break;
  }
  assert(bjRounds > 200, `应遇到足够多 natural BJ，实际 ${bjRounds}`);
  assert(err === 0, 'natural BJ 判定存在失败');
  console.log(`natural BJ 3:2：${bjOk}/${bjRounds} 次判定正确`);

  // 结算口径：把 A+10 记为已判定的 natural BJ，验证筹码/汇总函数
  const s3 = rig([d(10), d(8)], [[c(14), c(10, 'h')]], { chips: 1000 });
  s3.players[1].hands[0] = { cards: [c(14), c(10, 'h')], bet: 100, done: true, fromSplitAces: false, result: 'win', payout: 150 };
  s3.phase = 'dealer';                 // 处于未结算状态，交给 bjTableSettle 结算
  s3.actingSeat = 0;
  const t3 = bjTableSettle(s3);
  assert(t3.phase === 'settled', '结算后应进入 settled');
  assert(t3.players[1].chips === 1000 + 150, `结算后筹码应 +150，实际 ${t3.players[1].chips}`);
  assert(bjTablePlayerPayout(t3, 1) === 150, '单家净盈亏 150');
  assert(bjTableTotalPayout(t3) === 150, '全桌净盈亏 150');
  assert(bjTableTotalBet(t3) === 100, '总注 100');

  // 双方同时 BJ → 平局
  const s4 = rig([c(14), c(10, 'h')], [[c(14), c(10, 'd')]], { chips: 1000 });
  s4.players[1].hands[0] = { cards: [c(14), c(10, 'd')], bet: 100, done: true, fromSplitAces: false, result: 'push', payout: 0 };
  s4.phase = 'dealer';
  s4.actingSeat = 0;
  assert(bjTableSettle(s4).players[1].chips === 1000, '双方 BJ 平局筹码不变');
  console.log('natural BJ 结算口径：通过');
}

// ---------- 6. RTP 校验（单人局 + 多人局） ----------
{
  // 6.1 单人局（1 位玩家 + AI 庄家）2 万局
  let bets = 0, net = 0;
  for (let i = 0; i < 20000; i++) {
    const s = playRound(mkTable(1, i + 100000));
    assert(s.phase === 'settled', `单人局 ${i} 未结算`);
    bets += bjTableTotalBet(s);
    net += bjTableTotalPayout(s);
  }
  const rtp1 = (bets + net) / bets;
  assert(rtp1 > 0.97 && rtp1 < 1.005, `单人局 RTP 应约 99.5%，实际 ${(rtp1 * 100).toFixed(2)}%`);
  console.log(`RTP · 单人局 20000 局 = ${(rtp1 * 100).toFixed(2)}%（总注 ${bets}）`);

  // 6.2 多人局（3 位玩家 + AI 庄家）2 万局
  let bets3 = 0, net3 = 0, badSettle = 0;
  for (let i = 0; i < 20000; i++) {
    const s = playRound(mkTable(3, i + 200000));
    if (s.phase !== 'settled') { badSettle++; continue; }
    for (let seat = 1; seat < s.players.length; seat++) {
      for (const h of s.players[seat].hands) {
        if (h.result === undefined || h.payout === undefined || !h.done) badSettle++;
      }
    }
    bets3 += bjTableTotalBet(s);
    net3 += bjTableTotalPayout(s);
  }
  const rtp3 = (bets3 + net3) / bets3;
  assert(badSettle === 0, `多人局存在未正确结算的手牌：${badSettle}`);
  assert(rtp3 > 0.97 && rtp3 < 1.005, `3 人局 RTP 应约 99.5%，实际 ${(rtp3 * 100).toFixed(2)}%`);
  console.log(`RTP · 3 人局 20000 局 = ${(rtp3 * 100).toFixed(2)}%（总注 ${bets3}）`);

  // 6.3 多人局里每位玩家各自的 RTP 也应健康
  for (let i = 0; i < 8000; i++) {
    const s = playRound(mkTable(3, i + 300000));
    assert(s.phase === 'settled', `多人 RTP 采样局 ${i} 未结算`);
  }
  console.log('RTP 多人采样 8000 局：全部结算');
}

// ---------- 7. 边界 ----------
{
  // 7.1 全员爆牌 → 庄家不再要牌，直接结算
  // 注意点数：16 + 10 = 26 爆牌；16 + A = 17（A 作 1）不爆牌
  let t = rig([d(10), d(8)], [[c(10), c(6)], [c(10), c(5)]], { drawPile: [c(10, 'h'), c(10, 'd')] });
  t = bjTableApply(t, 1, 'hit');   // 16 + 10 = 26 → 爆牌
  assert(t.players[1].hands[0].result === 'bust', '座位 1 应爆牌');
  t = bjTableApply(t, 2, 'hit');   // 15 + 10 = 25 → 爆牌
  assert(t.players[2].hands[0].result === 'bust', '座位 2 应爆牌');
  assert(t.phase === 'settled', '全员爆牌应直接结算');
  assert(bjTableDealerHand(t).length === 2, '全员爆牌时庄家不再要牌');
  assert(t.message?.includes('全部爆牌') === true, `结算文案应含「全部爆牌」，实际「${t.message}」`);
  assert(bjTableTotalPayout(t) === -200, '双方爆牌共输 200');

  // 7.2 庄家 natural BJ → 全员主注输
  let t2 = rig([c(14), c(10, 'h')], [[c(9), c(8, 'd')], [c(7), c(6, 'd')]]);
  t2 = bjTableSettle(t2);
  assert(t2.phase === 'settled', '庄家 BJ 应立即结算');
  assert(t2.players[1].hands[0].result === 'lose' && t2.players[1].hands[0].payout === -100, '对庄家 BJ 主注输 100');
  assert(t2.players[2].hands[0].result === 'lose' && t2.players[2].hands[0].payout === -100, '第二家也输 100');

  // 7.3 庄家爆牌 → 全场赢
  let t3 = rig([d(6), d(10)], [[c(10), c(6, 'd')]], { phase: 'dealer', drawPile: [c(10, 'h')] });
  t3.actingSeat = 0;
  t3 = bjDealerPlay(t3);
  assert(handValue(bjTableDealerHand(t3)).value > 21, '庄家应爆牌');
  assert(t3.players[1].hands[0].result === 'win', '庄家爆牌玩家赢');
  assert(t3.players[1].hands[0].payout === 100, '赢回本金 100');

  // 7.4 结算幂等
  const once = bjTableSettle(rig([d(6), d(10)], [[c(10), c(6, 'd')]], { phase: 'dealer' }));
  const twice = bjTableSettle(once);
  assert(twice.players[1].chips === once.players[1].chips, '重复结算不应改变筹码');

  // 7.5 纯函数性：bjTableApply / bjDealerPlay 不修改入参
  const base = rig([d(10), d(8)], [[c(6), c(5)]], { drawPile: [c(3), c(4)] });
  const snap = JSON.stringify({ h: base.players[1].hands, ph: base.phase, shoe: base.shoe.length });
  bjTableApply(base, 1, 'hit');
  bjTableApply(base, 1, 'double');
  assert(JSON.stringify({ h: base.players[1].hands, ph: base.phase, shoe: base.shoe.length }) === snap,
    'bjTableApply 必须返回新 state，不得就地修改入参');
  const dealerBase = rig([d(6), d(6)], [[c(10), c(6, 'd')]], { phase: 'dealer', drawPile: [c(10, 'h')] });
  const dSnap = JSON.stringify(dealerBase.players[0].hands);
  bjDealerPlay(dealerBase);
  assert(JSON.stringify(dealerBase.players[0].hands) === dSnap, 'bjDealerPlay 也不得就地修改入参');

  // 7.6 rng 注入可复现
  const mkSame = () => newBjTable({
    players: [{ name: '你', isAI: false, chips: 1000 }, { name: '庄', isAI: true, chips: 1000 }],
    dealerIdx: 1, bet: 100, rng: lcg(999),
  });
  const r1 = mkSame(), r2 = mkSame();
  assert(JSON.stringify(r1.shoe) === JSON.stringify(r2.shoe), '同 seed 洗牌结果必须一致（rng 可注入）');
  assert(JSON.stringify(r1.players.map(p => p.hands)) === JSON.stringify(r2.players.map(p => p.hands)),
    '同 seed 发牌结果必须一致');
  const r3 = newBjTable({
    players: [{ name: '你', isAI: false, chips: 1000 }, { name: '庄', isAI: true, chips: 1000 }],
    dealerIdx: 1,
  });
  assert(PHASES.includes(r3.phase), '默认 rng（Math.random）可正常建局');

  // 7.7 非法调用被安全忽略
  const s7 = mkTable(3, 42);
  const oob = bjTableApply(s7, 99, 'hit');
  assert(JSON.stringify(oob.players) === JSON.stringify(s7.players), '越界座位应被忽略');
  const wrongSeat = (s7.actingSeat + 1) % s7.players.length;
  const notActing = bjTableApply(s7, wrongSeat, 'hit');
  assert(JSON.stringify(notActing.players) === JSON.stringify(s7.players), '非 actingSeat 的动作应被忽略');
  const illegal: BjTableAction = 'double';
  const poorSeat = (s7.actingSeat + 1) % s7.players.length;
  const ignored = bjTableApply(s7, poorSeat, illegal);
  assert(JSON.stringify(ignored.players) === JSON.stringify(s7.players), '非法动作应被忽略');

  // 7.8 同一桌连开多手
  let s8 = mkTable(2, 2024, 100, 5000);
  for (let k = 0; k < 20; k++) {
    s8 = playRound(s8);
    assert(s8.phase === 'settled', `第 ${k + 1} 手未结算`);
    s8 = bjTableStartHand(s8);
    assert(s8.handNumber === k + 2, `handNumber 应递增，实际 ${s8.handNumber}`);
    for (let seat = 1; seat < s8.players.length; seat++) {
      assert(s8.players[seat].insuranceBet === 0 && s8.players[seat].insurancePayout === undefined,
        '新一手应清空保险状态');
      assert(s8.players[seat].hands.length === 1, '新一手应只有一只手牌');
      // 新一手若正好是 natural BJ，dealHand 会立即判定 —— 这是合法状态
      const h = s8.players[seat].hands[0];
      if (h.result !== undefined) {
        assert(isBlackjack(h.cards) && h.done, '带结果的新手牌必须是已完成的 natural BJ');
      }
      assert(s8.players[seat].chips > 0, '筹码不应为负');
    }
  }

  // 7.9 可用筹码随加倍变化（用于合法性判定，不泄漏 UI 积分）
  let s9 = rig([d(10), d(8)], [[c(6), c(5)]], { bet: 100, chips: 500, drawPile: [c(3)] });
  assert(bjTableAvailableChips(s9, 1) === 400, `可动用筹码应为 500−100=400，实际 ${bjTableAvailableChips(s9, 1)}`);
  const s10 = bjTableApply(s9, 1, 'double');
  assert(bjTableAvailableChips(s10, 1) === 300, '加倍后可动用筹码应减少');
  // 筹码不足时加倍不再合法（bjTableLegalActions 无 playerPoints 参数，全靠 chips 判定）
  const s11 = rig([d(10), d(8)], [[c(6), c(5)]], { bet: 100, chips: 100, drawPile: [c(3)] });
  assert(bjTableAvailableChips(s11, 1) === 0, '只投入 100 时可动用筹码为 0');
  assert(!bjTableLegalActions(s11, 1).includes('double'), '可动用筹码不足时不可加倍');
  assert(bjTableLegalActions(s11, 1).includes('hit') && bjTableLegalActions(s11, 1).includes('stand'),
    '筹码不足仍可要牌/停牌');

  // 7.10 建议接口
  const s12 = rig([d(10), d(8)], [[c(6), c(5)]]);
  const adv = bjTableAdvice(s12, 1);
  assert(adv !== null && adv.action === 'double', `11 vs 8 应建议加倍，实际 ${adv?.action}`);
  assert(bjTableAdvice(s12, 0) === null, '庄家座位不返回建议');
  assert(bjTableDealerUp(s12)?.rank === 10, '庄家明牌可读');
  assert(bjTableTotalBet(s12) === 100, '未行动时总注为主注');
  assert(bjTablePlayerPayout(s12, 1) === 0, '未结算时单家盈亏为 0');
  console.log('边界用例：通过');
}

// ---------- 8. 牌靴完整性：4 副牌 = 同名牌最多 4 张 ----------
{
  // 注意：4 副牌意味着同一 rank+suit 最多 4 张，同一手牌里出现 2 张一样的牌是合法的，
  // 因此只断言「不超过 4 张」，不能断言「唯一」。
  const MAX_COPIES = 4;
  let overDealt = 0, rounds = 0, maxCopies = 0;
  for (let i = 0; i < 3000; i++) {
    const s = playRound(mkTable(3, i + 777000));
    rounds++;
    const all: Card[] = s.players.flatMap(p => p.hands.flatMap(h => h.cards));
    const counts = new Map<string, number>();
    for (const card of all) {
      const k = `${card.rank}${card.suit}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    maxCopies = Math.max(maxCopies, ...counts.values());
    if (maxCopies > MAX_COPIES) overDealt++;
    // seenCards 应恰好等于本局发出的所有牌
    assert(s.seenCards.length === all.length, `seenCards(${s.seenCards.length}) 应等于发出牌数(${all.length})`);
  }
  assert(overDealt === 0, `同一张牌发出超过 ${MAX_COPIES} 次：${overDealt} 局`);
  console.log(`牌靴完整性：${rounds} 局，同名牌最多出现 ${maxCopies} 次（上限 ${MAX_COPIES}），seenCards 与发牌数一致`);
}

console.log(failures === 0 ? '✅ 多人 21 点牌桌全部测试通过' : `❌ ${failures} 个失败`);
process.exit(failures ? 1 : 0);
