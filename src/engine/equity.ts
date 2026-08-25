// 蒙特卡洛胜率计算
import type { Card } from './cards';
import { createDeck, cardKey, shuffle } from './cards';
import { evaluate } from './evaluate';

export interface EquityResult {
  win: number;   // 独占底池概率 0..1
  tie: number;   // 平分概率
  equity: number; // win + tie/n
  iterations: number;
}

/**
 * 估算 hero 手牌在当前公共牌下对阵 nOpponents 个随机手牌的胜率。
 * iterations 越大越准但越慢；UI 实时显示建议 800~2000。
 */
export function calcEquity(
  heroCards: Card[],
  board: Card[],
  nOpponents: number,
  iterations = 1500,
  rng: () => number = Math.random,
): EquityResult {
  if (heroCards.length !== 2 || nOpponents < 1) {
    return { win: 0, tie: 0, equity: 0, iterations: 0 };
  }
  const known = new Set([...heroCards, ...board].map(cardKey));
  const deck = createDeck().filter(c => !known.has(cardKey(c)));
  const boardNeed = 5 - board.length;

  let win = 0, tie = 0, done = 0;
  for (let it = 0; it < iterations; it++) {
    // 抽 2*nOpponents + boardNeed 张牌
    const sample = shuffle(deck, rng).slice(0, 2 * nOpponents + boardNeed);
    const runout = [...board, ...sample.slice(0, boardNeed)];
    const oppHands: Card[][] = [];
    for (let p = 0; p < nOpponents; p++) {
      oppHands.push([sample[boardNeed + 2 * p], sample[boardNeed + 2 * p + 1]]);
    }
    const heroScore = evaluate([...heroCards, ...runout]).score;
    let bestOpp = -1;
    for (const h of oppHands) {
      const s = evaluate([...h, ...runout]).score;
      if (s > bestOpp) bestOpp = s;
    }
    done++;
    if (heroScore > bestOpp) win++;
    else if (heroScore === bestOpp) tie++;
  }
  const w = win / done, t = tie / done;
  return { win: w, tie: t, equity: w + t / nOpponents, iterations: done };
}

/** 听牌分析：检测同花听、顺子听等，用于教学提示 */
export interface DrawInfo {
  flushDraw: boolean;      // 4 张同花
  flushDrawSuit?: string;
  oesd: boolean;           // 两头顺听
  gutshot: boolean;        // 卡顺
  overcards: number;       // 比公共牌最大牌大的手牌张数
  outs: number;            // 大约补牌数
  pairWithBoard: boolean;  // 与公共牌成对
  topPairOrBetter: boolean;
}

export function analyzeDraws(hero: Card[], board: Card[]): DrawInfo {
  const all = [...hero, ...board];
  const info: DrawInfo = {
    flushDraw: false, oesd: false, gutshot: false,
    overcards: 0, outs: 0, pairWithBoard: false, topPairOrBetter: false,
  };
  if (board.length < 3) return info;

  // 同花听
  const suitCount = new Map<string, number>();
  for (const c of all) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  for (const [suit, n] of suitCount) {
    if (n === 4 && hero.some(c => c.suit === suit)) {
      info.flushDraw = true;
      info.flushDrawSuit = suit;
    }
  }

  // 顺子听：枚举所有 5 连窗口，检查已有关键张数
  const rankSet = new Set(all.map(c => c.rank));
  const boardMax = Math.max(...board.map(c => c.rank));
  let oesd = false, gutshot = false;
  for (let lo = 2; lo <= 10; lo++) {
    const window = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
    const have = window.filter(r => rankSet.has(r));
    const missing = window.filter(r => !rankSet.has(r));
    if (have.length === 4 && missing.length === 1) {
      // 缺一端 = OESD；缺中间 = 卡顺
      if (missing[0] === lo || missing[0] === lo + 4) oesd = true;
      else gutshot = true;
    }
  }
  // A2345 / TJQKA 特殊窗口（A 高/低）
  for (const window of [[14, 2, 3, 4, 5], [10, 11, 12, 13, 14]]) {
    const have = window.filter(r => rankSet.has(r));
    const missing = window.filter(r => !rankSet.has(r));
    if (have.length === 4 && missing.length === 1) {
      if (missing[0] === window[0] || missing[0] === window[4]) oesd = true;
      else gutshot = true;
    }
  }
  info.oesd = oesd;
  info.gutshot = gutshot;

  info.overcards = hero.filter(c => c.rank > boardMax).length;
  info.pairWithBoard = hero.some(c => board.some(b => b.rank === c.rank));
  info.topPairOrBetter = hero.some(c => c.rank === boardMax);

  // 粗略补牌数
  let outs = 0;
  if (info.flushDraw) outs += 9;
  if (info.oesd) outs += 8;
  else if (info.gutshot) outs += 4;
  if (!info.pairWithBoard && !info.flushDraw && !info.oesd && !info.gutshot) {
    outs += info.overcards * 3;
  }
  info.outs = outs;
  return info;
}
