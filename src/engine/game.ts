// 德州扑克游戏状态机（6 人桌）
import type { Card } from './cards';
import { createDeck, shuffle, cardToString, handNotation } from './cards';
import { evaluate } from './evaluate';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handOver';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface Player {
  id: number;
  name: string;
  style: string;        // AI 风格，hero 为 '你'
  chips: number;
  hole: Card[];
  streetBet: number;    // 当前下注轮已投入
  handBet: number;      // 整手牌已投入
  folded: boolean;
  allIn: boolean;
  isHero: boolean;
  needsAction: boolean;
  lastAction?: string;  // 展示用
}

export interface GameState {
  players: Player[];
  dealerIdx: number;
  community: Card[];
  deck: Card[];
  pot: number;
  street: Street;
  currentBet: number;   // 本轮需要匹配的下注额
  minRaise: number;     // 最小加注增量
  actingIdx: number;    // -1 表示无需行动
  bigBlind: number;
  smallBlind: number;
  handNumber: number;
  winners?: { playerId: number; amount: number; handName: string }[];
  handOverInfo?: string;
}

export const STREET_NAME: Record<Street, string> = {
  preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌',
  showdown: '摊牌', handOver: '本手结束',
};

export const POSITION_NAMES_6MAX = ['BTN 按钮位', 'SB 小盲', 'BB 大盲', 'UTG 枪口位', 'MP 中间位', 'CO 关煞位'];

/** 返回 hero 相对庄家位置名（6 人桌） */
export function heroPositionName(state: GameState, playerIdx: number): string {
  const offset = (playerIdx - state.dealerIdx + state.players.length) % state.players.length;
  return POSITION_NAMES_6MAX[offset] ?? `位置${offset}`;
}

export function newHand(
  prevPlayers: { id: number; name: string; style: string; chips: number; isHero: boolean }[],
  dealerIdx: number,
  handNumber: number,
  smallBlind = 10,
  bigBlind = 20,
): GameState {
  const n = prevPlayers.length;
  const deck = shuffle(createDeck());
  const players: Player[] = prevPlayers.map(p => ({
    ...p,
    hole: [deck.pop()!, deck.pop()!],
    streetBet: 0,
    handBet: 0,
    folded: p.chips <= 0,
    allIn: false,
    needsAction: p.chips > 0,
    lastAction: undefined,
  }));

  const sbIdx = (dealerIdx + 1) % n;
  const bbIdx = (dealerIdx + 2) % n;
  const post = (p: Player, amount: number) => {
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.streetBet += paid;
    p.handBet += paid;
    if (p.chips === 0) p.allIn = true;
  };
  post(players[sbIdx], smallBlind);
  post(players[bbIdx], bigBlind);
  players[sbIdx].lastAction = `小盲 ${smallBlind}`;
  players[bbIdx].lastAction = `大盲 ${bigBlind}`;

  return {
    players,
    dealerIdx,
    community: [],
    deck,
    pot: smallBlind + bigBlind,
    street: 'preflop',
    currentBet: bigBlind,
    minRaise: bigBlind,
    actingIdx: (dealerIdx + 3) % n,
    bigBlind,
    smallBlind,
    handNumber,
  };
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.folded);
}

function nextToAct(state: GameState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const p = state.players[idx];
    if (p.needsAction && !p.folded && !p.allIn && p.chips > 0) return idx;
  }
  return -1;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number; // 全下
}

export function legalActions(state: GameState, idx: number): LegalActions {
  const p = state.players[idx];
  const toCall = state.currentBet - p.streetBet;
  const maxTo = p.streetBet + p.chips;
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.chips),
    canRaise: p.chips > toCall,
    minRaiseTo: Math.min(state.currentBet + state.minRaise, maxTo),
    maxRaiseTo: maxTo,
  };
}

export type ApplyResult =
  | { ok: true; state: GameState; streetAdvanced?: boolean; handEnded?: boolean }
  | { ok: false; reason: string };

export function applyAction(
  state: GameState,
  idx: number,
  action: ActionType,
  raiseTo?: number,
): ApplyResult {
  if (state.actingIdx !== idx) return { ok: false, reason: '还没轮到你行动' };
  const s: GameState = structuredClone(state);
  const p = s.players[idx];
  const la = legalActions(s, idx);
  const toCall = s.currentBet - p.streetBet;

  switch (action) {
    case 'fold':
      if (!la.canFold && toCall === 0) return { ok: false, reason: '无需弃牌，可以过牌' };
      p.folded = true;
      p.lastAction = '弃牌';
      break;
    case 'check':
      if (!la.canCheck) return { ok: false, reason: '不能过牌，需要跟注' };
      p.lastAction = '过牌';
      break;
    case 'call': {
      if (!la.canCall) return { ok: false, reason: '无需跟注' };
      const paid = Math.min(toCall, p.chips);
      p.chips -= paid;
      p.streetBet += paid;
      p.handBet += paid;
      p.lastAction = paid < toCall ? `全下 ${p.handBet}` : `跟注 ${paid}`;
      if (p.chips === 0) p.allIn = true;
      break;
    }
    case 'bet':
    case 'raise':
    case 'allin': {
      let target: number;
      if (action === 'allin') target = la.maxRaiseTo;
      else target = raiseTo ?? la.minRaiseTo;
      target = Math.min(Math.max(target, la.minRaiseTo), la.maxRaiseTo);
      if (!la.canRaise && target < la.minRaiseTo) return { ok: false, reason: '筹码不足，无法加注' };
      const invest = target - p.streetBet;
      if (invest <= 0) return { ok: false, reason: '加注额无效' };
      p.chips -= invest;
      p.streetBet = target;
      p.handBet += invest;
      const raiseInc = target - s.currentBet;
      if (target > s.currentBet) {
        if (raiseInc >= s.minRaise || p.chips === 0) {
          s.minRaise = Math.max(raiseInc, s.bigBlind);
          s.currentBet = target;
          // 其他未弃牌未全下玩家需要重新行动
          for (const q of s.players) {
            if (q.id !== p.id && !q.folded && !q.allIn && q.chips > 0) q.needsAction = true;
          }
        }
      }
      p.lastAction = p.chips === 0 ? `全下 ${p.handBet}` : (action === 'bet' && toCall === 0 ? `下注 ${invest}` : `加注到 ${target}`);
      if (p.chips === 0) p.allIn = true;
      break;
    }
  }
  p.needsAction = false;
  return advance(s);
}

function advance(s: GameState): ApplyResult {
  // 只剩一人未弃牌 → 直接赢
  const alive = s.players.filter(p => !p.folded);
  if (alive.length === 1) {
    const w = alive[0];
    const total = s.players.reduce((sum, p) => sum + p.handBet, 0);
    w.chips += total;
    s.pot = 0;
    s.street = 'handOver';
    s.winners = [{ playerId: w.id, amount: total, handName: '对手弃牌' }];
    s.handOverInfo = `${w.name} 赢得底池 ${total}`;
    s.actingIdx = -1;
    return { ok: true, state: s, handEnded: true };
  }

  // 行动下一位
  const next = nextToAct(s, s.actingIdx);
  if (next !== -1) {
    s.actingIdx = next;
    s.pot = s.players.reduce((sum, p) => sum + p.handBet, 0) - s.players.reduce((sum, p) => sum + (p.folded ? 0 : 0), 0);
    s.pot = s.players.reduce((sum, p) => sum + p.handBet, 0);
    return { ok: true, state: s };
  }

  // 本轮结束：所有人要么全下要么已跟齐
  const canAct = alive.filter(p => !p.allIn && p.chips > 0);
  const needMoreCards = s.street !== 'river';
  const everyoneAllIn = canAct.length <= 1;

  const advanceStreet = () => {
    for (const p of s.players) {
      p.streetBet = 0;
      p.needsAction = !p.folded && !p.allIn && p.chips > 0;
      if (!p.folded && !p.allIn) p.lastAction = undefined;
    }
    s.currentBet = 0;
    s.minRaise = s.bigBlind;
    // 翻牌后从庄家下一位开始
    const n = s.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (s.dealerIdx + i) % n;
      const p = s.players[idx];
      if (p.needsAction) { s.actingIdx = idx; break; }
      s.actingIdx = -1;
    }
    s.pot = s.players.reduce((sum, p) => sum + p.handBet, 0);
  };

  if (everyoneAllIn) {
    // 直接发完公共牌到摊牌
    while (s.community.length < 5) s.community.push(s.deck.pop()!);
    s.street = 'showdown';
    return showdown(s);
  }

  if (needMoreCards) {
    const deal = (m: number) => { for (let i = 0; i < m; i++) s.community.push(s.deck.pop()!); };
    if (s.street === 'preflop') { deal(3); s.street = 'flop'; }
    else if (s.street === 'flop') { deal(1); s.street = 'turn'; }
    else if (s.street === 'turn') { deal(1); s.street = 'river'; }
    advanceStreet();
    if (s.actingIdx === -1) {
      // 无人能行动（全下情况兜底）
      while (s.community.length < 5) s.community.push(s.deck.pop()!);
      s.street = 'showdown';
      return showdown(s);
    }
    return { ok: true, state: s, streetAdvanced: true };
  }

  // river 行动结束 → 摊牌
  s.street = 'showdown';
  return showdown(s);
}

function showdown(s: GameState): ApplyResult {
  const alive = s.players.filter(p => !p.folded);
  // 计算每人牌力
  const scores = new Map<number, ReturnType<typeof evaluate>>();
  for (const p of alive) {
    scores.set(p.id, evaluate([...p.hole, ...s.community]));
  }
  // 边池分配：按 handBet 层级
  const payouts = new Map<number, number>();
  const bets = alive.map(p => ({ id: p.id, bet: p.handBet }));
  const foldedBets = s.players.filter(p => p.folded).map(p => ({ id: p.id, bet: p.handBet }));
  const allBets = [...bets, ...foldedBets];
  const levels = [...new Set(allBets.map(b => b.bet))].sort((a, b) => a - b);
  let prev = 0;
  for (const level of levels) {
    const contributors = allBets.filter(b => b.bet >= level);
    const potPart = contributors.length * (level - prev);
    prev = level;
    const eligible = alive.filter(p => p.handBet >= level);
    let bestScore = -1;
    for (const p of eligible) bestScore = Math.max(bestScore, scores.get(p.id)!.score);
    const winnersHere = eligible.filter(p => scores.get(p.id)!.score === bestScore);
    const share = Math.floor(potPart / winnersHere.length);
    let remainder = potPart - share * winnersHere.length;
    // 余数筹码按座位顺序（庄家左侧优先，此处简化为 id 顺序）逐个分配
    for (const w of winnersHere) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      payouts.set(w.id, (payouts.get(w.id) ?? 0) + share + extra);
    }
  }
  // 未匹配的超额下注退还（极端情况兜底）
  const maxAliveBet = Math.max(...bets.map(b => b.bet));
  for (const b of bets) {
    if (b.bet > maxAliveBet) {
      // 不会发生，因为 bets 都是 alive
    }
  }
  const winners: { playerId: number; amount: number; handName: string }[] = [];
  for (const [id, amount] of payouts) {
    const p = s.players.find(p => p.id === id)!;
    p.chips += amount;
    winners.push({ playerId: id, amount, handName: scores.get(id)?.name ?? '' });
  }
  s.winners = winners;
  const desc = winners.map(w => {
    const p = s.players.find(p => p.id === w.playerId)!;
    return `${p.name} 以【${w.handName}】赢得 ${w.amount}`;
  }).join('；');
  s.handOverInfo = desc;
  s.pot = 0;
  s.street = 'handOver';
  s.actingIdx = -1;
  return { ok: true, state: s, handEnded: true };
}

/** 判断当前是否轮到 hero */
export function isHeroTurn(state: GameState): boolean {
  return state.actingIdx >= 0 && state.players[state.actingIdx]?.isHero === true;
}

export { cardToString, handNotation };
