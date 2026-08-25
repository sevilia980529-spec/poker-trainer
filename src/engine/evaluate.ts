// 牌力评估：7 选 5 最大牌型，返回可比较的数值分数（越大越强）
import type { Card } from './cards';

export const HAND_NAMES = [
  '高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺',
];

// 5 张牌评估。分数编码：category * 10^10 + 关键牌依次占位
function eval5(cards: Card[]): number {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const flush = suits.every(s => s === suits[0]);

  // 统计每个点数的张数
  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  // 按 (张数, 点数) 降序排列
  const groups = [...countMap.entries()].sort((a, b) =>
    b[1] - a[1] || b[0] - a[0]
  );

  // 顺子检测（含 A2345 轮子）
  let straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // A-2-3-4-5
  }

  const encode = (cat: number, kickers: number[]): number => {
    let score = cat;
    for (const k of kickers) score = score * 15 + k;
    return score;
  };

  if (flush && straightHigh) return encode(8, [straightHigh, 0, 0, 0, 0]);
  if (groups[0][1] === 4) return encode(7, [groups[0][0], groups[1][0], 0, 0, 0]);
  if (groups[0][1] === 3 && groups[1][1] === 2)
    return encode(6, [groups[0][0], groups[1][0], 0, 0, 0]);
  if (flush) return encode(5, [...ranks]);
  if (straightHigh) return encode(4, [straightHigh, 0, 0, 0, 0]);
  if (groups[0][1] === 3)
    return encode(3, [groups[0][0], groups[1][0], groups[2][0], 0, 0]);
  if (groups[0][1] === 2 && groups[1][1] === 2)
    return encode(2, [groups[0][0], groups[1][0], groups[2][0], 0, 0]);
  if (groups[0][1] === 2)
    return encode(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0], 0]);
  return encode(0, [...ranks]);
}

export interface EvalResult {
  score: number;
  category: number; // 0..8
  name: string;
  best: Card[];
}

/** 从 7 张（或 5/6 张）牌中找出最大牌型 */
export function evaluate(cards: Card[]): EvalResult {
  const n = cards.length;
  let bestScore = -1;
  let bestCombo: Card[] = [];
  // 组合枚举 C(n,5)
  const idx = [0, 1, 2, 3, 4];
  while (idx) {
    const combo = idx.map(i => cards[i]);
    const s = eval5(combo);
    if (s > bestScore) {
      bestScore = s;
      bestCombo = combo;
    }
    // 生成下一个组合
    let k = 4;
    while (k >= 0 && idx[k] === n - 5 + k) k--;
    if (k < 0) break;
    idx[k]++;
    for (let j = k + 1; j < 5; j++) idx[j] = idx[j - 1] + 1;
  }
  // encode 里 category 是第一个乘基前的数：score = (((((cat*15+k1)*15+k2)...，共 5 个 kicker
  let tmp = bestScore;
  for (let i = 0; i < 5; i++) tmp = Math.floor(tmp / 15);
  const cat = tmp;
  return { score: bestScore, category: cat, name: HAND_NAMES[cat] ?? '高牌', best: bestCombo };
}
