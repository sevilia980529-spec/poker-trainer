// 21点（Blackjack）规则引擎 v2
// 规则：4 副牌靴、庄家所有 17 停牌、Blackjack 赔 1.5 倍、双倍下注、分牌（分 A 各补一张）、保险（赔 2:1）
import { createDeck, shuffle, type Card } from '../../engine/cards';

export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'insurance' | 'no-insurance';

export interface BjHand {
  cards: Card[];
  bet: number;
  done: boolean;        // 停牌/爆牌/分A补牌完毕
  fromSplitAces: boolean;
  result?: 'win' | 'lose' | 'push' | 'bust';
  payout?: number;      // 净盈亏
}

export interface BjState {
  shoe: Card[];
  hands: BjHand[];
  activeHand: number;   // 当前操作的手牌索引
  dealerHand: Card[];
  doubledFlags: boolean[];
  phase: 'insurance' | 'player' | 'dealer' | 'settled';
  insuranceBet: number;
  insurancePayout?: number; // 保险净盈亏
  message?: string;
  seenCards: Card[];
}

export function bjCardValue(c: Card): number {
  if (c.rank >= 10) return 10;
  return c.rank; // A=14 → 调用方处理为 1/11
}

export function handValue(hand: Card[]): { value: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 14) { aces++; total += 11; }
    else total += bjCardValue(c);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { value: total, soft: aces > 0 };
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand).value === 21;
}

export function newShoe(): Card[] {
  const shoe: Card[] = [];
  for (let i = 0; i < 4; i++) shoe.push(...createDeck());
  return shuffle(shoe);
}

function draw(s: BjState): Card {
  if (s.shoe.length < 52) {
    s.shoe = newShoe();
    s.seenCards = [];
  }
  const c = s.shoe.pop()!;
  s.seenCards.push(c);
  return c;
}

export function startRound(bet: number): BjState {
  const s: BjState = {
    shoe: newShoe(),
    hands: [{ cards: [], bet, done: false, fromSplitAces: false }],
    activeHand: 0,
    dealerHand: [],
    doubledFlags: [],
    phase: 'player',
    insuranceBet: 0,
    seenCards: [],
  };
  s.hands[0].cards.push(draw(s), draw(s));
  s.dealerHand.push(draw(s), draw(s));

  const pBJ = isBlackjack(s.hands[0].cards);
  const dBJ = isBlackjack(s.dealerHand);

  // 庄家明牌是 A 且玩家非 BJ → 先问保险
  if (s.dealerHand[0].rank === 14 && !pBJ) {
    s.phase = 'insurance';
    return s;
  }

  if (pBJ || dBJ) {
    s.phase = 'settled';
    if (pBJ && dBJ) {
      s.hands[0].result = 'push'; s.hands[0].payout = 0;
      s.message = '双方 Blackjack，平局';
    } else if (pBJ) {
      s.hands[0].result = 'win'; s.hands[0].payout = Math.floor(bet * 1.5);
      s.message = `Blackjack！赢 ${Math.floor(bet * 1.5)}`;
    } else {
      s.hands[0].result = 'lose'; s.hands[0].payout = -bet;
      s.message = '庄家 Blackjack，你输了';
    }
  }
  return s;
}

/** 回答保险问题 */
export function bjInsurance(s0: BjState, take: boolean, maxInsurance: number): BjState {
  const s: BjState = structuredClone(s0);
  if (s.phase !== 'insurance') return s;
  if (take) s.insuranceBet = Math.min(Math.floor(s.hands[0].bet / 2), maxInsurance);
  const dBJ = isBlackjack(s.dealerHand);
  if (dBJ) {
    s.phase = 'settled';
    s.insurancePayout = take ? s.insuranceBet * 2 : 0; // 赔 2:1 → 净赚 2 倍保险注
    s.hands[0].result = 'lose';
    s.hands[0].payout = -s.hands[0].bet;
    s.message = take
      ? `庄家 Blackjack。保险赔 2:1（净赚 ${s.insuranceBet * 2}），主注输 ${s.hands[0].bet}`
      : '庄家 Blackjack，你输了';
    return s;
  }
  s.insurancePayout = take ? -s.insuranceBet : 0;
  s.phase = 'player';
  s.message = take ? `庄家没有 Blackjack，保险注 ${s.insuranceBet} 损失` : undefined;
  return s;
}

export function canSplit(s: BjState): boolean {
  if (s.phase !== 'player' || s.hands.length >= 4) return false;
  const h = s.hands[s.activeHand];
  return h.cards.length === 2 && bjCardValue(h.cards[0]) === bjCardValue(h.cards[1]);
}

export function legalBjActions(s: BjState, playerPoints = Infinity): BjAction[] {
  if (s.phase === 'insurance') return ['insurance', 'no-insurance'];
  if (s.phase !== 'player') return [];
  const h = s.hands[s.activeHand];
  const acts: BjAction[] = ['hit', 'stand'];
  if (h.cards.length === 2 && !h.fromSplitAces && playerPoints >= h.bet) acts.push('double');
  if (canSplit(s) && playerPoints >= h.bet) acts.push('split');
  return acts;
}

export function bjApply(s0: BjState, action: BjAction): BjState {
  const s: BjState = structuredClone(s0);
  if (s.phase !== 'player') return s;
  const h = s.hands[s.activeHand];

  switch (action) {
    case 'hit': {
      h.cards.push(draw(s));
      const v = handValue(h.cards);
      if (v.value > 21) { h.done = true; h.result = 'bust'; h.payout = -h.bet; }
      else if (v.value === 21) h.done = true;
      return nextHand(s);
    }
    case 'double': {
      h.bet *= 2;
      h.cards.push(draw(s));
      const v = handValue(h.cards);
      h.done = true;
      if (v.value > 21) { h.result = 'bust'; h.payout = -h.bet; }
      return nextHand(s);
    }
    case 'split': {
      if (!canSplit(s)) return s;
      const isAces = h.cards[0].rank === 14;
      const c1 = h.cards[0], c2 = h.cards[1];
      const newHands: BjHand[] = [
        { cards: [c1, draw(s)], bet: h.bet, done: false, fromSplitAces: isAces },
        { cards: [c2, draw(s)], bet: h.bet, done: false, fromSplitAces: isAces },
      ];
      s.hands.splice(s.activeHand, 1, ...newHands);
      if (isAces) {
        // 分 A 规则：各只补一张，直接完成
        newHands.forEach(nh => { nh.done = true; });
        return nextHand(s);
      }
      return s;
    }
    case 'stand':
    default: {
      h.done = true;
      return nextHand(s);
    }
  }
}

function nextHand(s: BjState): BjState {
  // 找下一手未完成的手牌
  for (let i = s.activeHand; i < s.hands.length; i++) {
    if (!s.hands[i].done) {
      s.activeHand = i;
      return s;
    }
  }
  // 全部完成
  const allBust = s.hands.every(h => h.result === 'bust');
  if (allBust) {
    s.phase = 'settled';
    s.message = '全部爆牌';
    return s;
  }
  return dealerPlay(s);
}

function dealerPlay(s: BjState): BjState {
  s.phase = 'dealer';
  while (true) {
    const d = handValue(s.dealerHand);
    if (d.value < 17) s.dealerHand.push(draw(s));
    else break;
  }
  return settle(s);
}

function settle(s: BjState): BjState {
  s.phase = 'settled';
  const d = handValue(s.dealerHand).value;
  const parts: string[] = [];
  s.hands.forEach((h, i) => {
    if (h.result === 'bust') { parts.push(`第${i + 1}手爆牌`); return; }
    const p = handValue(h.cards).value;
    if (d > 21 || p > d) { h.result = 'win'; h.payout = h.bet; parts.push(`第${i + 1}手 ${p}点胜`); }
    else if (p < d) { h.result = 'lose'; h.payout = -h.bet; parts.push(`第${i + 1}手 ${p}点负`); }
    else { h.result = 'push'; h.payout = 0; parts.push(`第${i + 1}手 ${p}点平`); }
  });
  s.message = (d > 21 ? `庄家爆牌（${d}点）。` : `庄家 ${d} 点。`) + parts.join('；');
  return s;
}

/** 当局总净盈亏（不含保险） */
export function totalPayout(s: BjState): number {
  return s.hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
}

/** 当局总投入（含分牌/双倍，不含保险） */
export function totalBet(s: BjState): number {
  return s.hands.reduce((sum, h) => sum + h.bet, 0);
}
