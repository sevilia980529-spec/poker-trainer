// 21点基本策略教练 + Hi-Lo 算牌训练
import type { Card } from '../../engine/cards';
import { handValue, bjCardValue, type BjAction } from './engine';

/**
 * 基本策略（庄家软17停牌、可双倍，不含分牌）
 * 返回建议动作 + 解释
 */
export function basicStrategy(
  playerHand: Card[],
  dealerUp: Card,
): { action: BjAction; why: string } {
  const { value, soft } = handValue(playerHand);
  const d = dealerUp.rank === 14 ? 11 : Math.min(dealerUp.rank, 10); // 2..11（A=11）
  const dealerWeak = d >= 2 && d <= 6;

  if (soft && value <= 21) {
    // 软牌
    if (value >= 19) return { action: 'stand', why: `软 ${value}（A 可作 11）是很强的牌，停牌。` };
    if (value === 18) {
      if (dealerWeak) return { action: 'double', why: `软 18 对庄家弱牌（2-6）应双倍——庄家爆牌率高，最大化收益。` };
      if (d <= 8) return { action: 'stand', why: '软 18 对庄家 7-8 停牌即可。' };
      return { action: 'hit', why: '软 18 对庄家 9/T/A 偏弱，软牌要牌不会爆，继续改进。' };
    }
    if (value === 17) {
      if (d >= 3 && d <= 6) return { action: 'double', why: '软 17 对庄家 3-6 双倍。软牌要牌零风险，值得加注。' };
      return { action: 'hit', why: '软 17 要牌零风险（A 可变 1），果断要牌改进。' };
    }
    // 软 13-16
    if (d >= 5 && d <= 6) return { action: 'double', why: `软 ${value} 对庄家 5-6 双倍——庄家最弱的两张牌面。` };
    return { action: 'hit', why: `软 ${value} 要牌零风险，没理由停。` };
  }

  // 硬牌
  if (value >= 17) return { action: 'stand', why: `硬 ${value} 停牌。要牌爆牌率太高。` };
  if (value >= 13 && value <= 16) {
    if (dealerWeak) {
      return { action: 'stand', why: `硬 ${value} 对庄家弱牌（2-6）停牌——让庄家去爆。庄家 2-6 时爆牌率 35-44%，你不需要冒险。` };
    }
    return { action: 'hit', why: `硬 ${value} 对庄家强牌（${d}）必须要牌——停牌等输。虽然可能爆牌，但这是亏损最小的打法。` };
  }
  if (value === 12) {
    if (d >= 4 && d <= 6) return { action: 'stand', why: '12 对庄家 4-6 停牌：庄家爆牌率足够高，不值得冒险要牌。' };
    return { action: 'hit', why: '12 对庄家强牌要牌（只有 T 会让你爆）。' };
  }
  if (value === 11) {
    if (d === 11) return { action: 'hit', why: '11 对 A 要牌（庄家 Blackjack 风险太大）。' };
    return { action: 'double', why: '11 是最经典的双倍时机——拿到 T 就是 21，对庄家任何 2-T 都双倍。' };
  }
  if (value === 10) {
    if (d <= 9) return { action: 'double', why: '10 对庄家 2-9 双倍。' };
    return { action: 'hit', why: '10 对庄家 T/A 只要牌（庄家太强，双倍风险大）。' };
  }
  if (value === 9) {
    if (d >= 3 && d <= 6) return { action: 'double', why: '9 对庄家 3-6 双倍。' };
    return { action: 'hit', why: '9 点要牌。' };
  }
  return { action: 'hit', why: `${value} 点太低，必须继续要牌。` };
}

export type BjGrade = 'excellent' | 'mistake';

// ---------- 分牌策略 ----------
/**
 * 分牌表（S17，分牌后可双倍）：返回是否应分牌 + 理由
 */
export function splitAdvice(playerHand: Card[], dealerUp: Card): { shouldSplit: boolean; why: string } | null {
  if (playerHand.length !== 2) return null;
  const v1 = bjCardValue(playerHand[0]);
  const v2 = bjCardValue(playerHand[1]);
  if (v1 !== v2) return null;
  const d = dealerUp.rank === 14 ? 11 : Math.min(dealerUp.rank, 10);
  const r = playerHand[0].rank;

  if (r === 14) return { shouldSplit: true, why: 'A-A 永远分牌：两张 11 起手远胜软 12。' };
  if (r === 8) return { shouldSplit: true, why: '8-8 永远分牌：硬 16 是最差的起手牌，分成两个 8 各有机会。' };
  if (r === 10 || r === 11 || r === 12 || r === 13) return { shouldSplit: false, why: 'T-T（20 点）永远不分——20 点只输 21。' };
  if (r === 5) return { shouldSplit: false, why: '5-5 不分：硬 10 是绝好的双倍牌，分开就毁了。' };
  if (r === 4) return (d === 5 || d === 6)
    ? { shouldSplit: true, why: '4-4 只对庄家 5-6 分牌。' }
    : { shouldSplit: false, why: '4-4 通常不分，按硬 8 要牌。' };
  if (r === 9) return (d <= 6 || d === 8 || d === 9)
    ? { shouldSplit: true, why: `9-9 对庄家 ${d} 分牌；对 7/T/A 则停（18 点已强）。` }
    : { shouldSplit: false, why: `9-9 对庄家 ${d === 7 ? '7' : 'T/A'} 不分：18 点大概率已赢或够用。` };
  if (r === 2 || r === 3 || r === 7) return d <= 7
    ? { shouldSplit: true, why: `${r}-${r} 对庄家 2-7 分牌。` }
    : { shouldSplit: false, why: `${r}-${r} 对庄家强牌不分，要牌。` };
  if (r === 6) return d <= 6
    ? { shouldSplit: true, why: '6-6 对庄家 2-6 分牌。' }
    : { shouldSplit: false, why: '6-6 对庄家强牌不分，要牌。' };
  return null;
}

export type BjActionAll = BjAction;

export function basicStrategyFull(
  playerHand: Card[],
  dealerUp: Card,
  canSplitHand: boolean,
): { action: BjAction; why: string } {
  if (canSplitHand) {
    const sp = splitAdvice(playerHand, dealerUp);
    if (sp?.shouldSplit) return { action: 'split', why: sp.why };
  }
  return basicStrategy(playerHand, dealerUp);
}

export function gradeBjActionFull(
  playerHand: Card[], dealerUp: Card, actual: BjAction, canSplitHand: boolean,
): { grade: BjGrade; advice: { action: BjAction; why: string } } {
  const advice = basicStrategyFull(playerHand, dealerUp, canSplitHand);
  // 分牌建议但未分：如果玩家选了该"牌面"的硬/软策略动作，算一半对
  if (actual !== advice.action && advice.action === 'split') {
    const fallback = basicStrategy(playerHand, dealerUp);
    if (actual === fallback.action) {
      return { grade: 'mistake', advice: { ...advice, why: `更优是分牌：${advice.why}（你选择按整手打也不算大错）` } };
    }
  }
  return { grade: actual === advice.action ? 'excellent' : 'mistake', advice };
}

export function gradeBjAction(
  playerHand: Card[], dealerUp: Card, actual: BjAction,
): { grade: BjGrade; advice: ReturnType<typeof basicStrategy> } {
  const advice = basicStrategy(playerHand, dealerUp);
  return { grade: actual === advice.action ? 'excellent' : 'mistake', advice };
}

// 保险教学：基本策略角度买保险是正期望吗？
export const INSURANCE_TEACHING = {
  advice: 'no-insurance' as const,
  why: '基本策略原则：永远不买保险。保险本质是"庄家底牌是否为 10"的独立 side bet——10 点牌占比约 30.8%，但赔率只有 2:1（需要 33.3% 才保本），长期必亏。唯一例外：算牌时真计数 ≥ +3，10 点牌足够密集，保险才转正期望。这是算牌者少数偏离基本策略的时刻之一。',
};

// ---------- Hi-Lo 算牌 ----------
export function hiLoValue(c: Card): number {
  const v = bjCardValue(c);
  if (v >= 2 && v <= 6) return 1;
  if (v >= 10 || v === 11) return -1; // T/J/Q/K/A
  return 0;
}

export interface CountInfo {
  running: number;   // 累积计数
  trueCount: number; // 真实计数 = running / 剩余副数
  decksLeft: number;
  edgeHint: string;  // 教学提示
}

export function countInfo(seenCards: Card[], shoeSize: number): CountInfo {
  const running = seenCards.reduce((s, c) => s + hiLoValue(c), 0);
  const decksLeft = Math.max(0.5, shoeSize / 52);
  const tc = running / decksLeft;
  let edgeHint: string;
  if (tc >= 3) edgeHint = '真计数很高：剩余牌大牌密集，玩家占优——基本策略之外可以考虑加大注码（算牌者的核心盈利手段）。';
  else if (tc >= 1) edgeHint = '真计数为正：略有利于玩家，大牌比例偏高。';
  else if (tc <= -2) edgeHint = '真计数很低：小牌密集，庄家占优，应下最小注。';
  else edgeHint = '计数中性：按基本策略正常打。';
  return { running, trueCount: Math.round(tc * 10) / 10, decksLeft: Math.round(decksLeft * 10) / 10, edgeHint };
}
