// AI 对手：多风格 bot 决策 + 真难度梯度
import type { GameState, ActionType } from '../engine/game';
import { legalActions } from '../engine/game';
import { calcEquity } from '../engine/equity';
import { evaluate } from '../engine/evaluate';
import { handNotation, type Card } from '../engine/cards';

export interface BotStyle {
  name: string;        // 展示名
  vpip: number;        // 入池率倾向 0..1
  aggression: number;  // 激进度 0..1
  bluffFreq: number;   // 诈唬频率 0..1
  looseness: number;   // 对底池赔率的宽松度（越大越爱跟注）
}

export const BOT_STYLES: Record<string, BotStyle> = {
  tag:      { name: '老陈·紧凶',   vpip: 0.25, aggression: 0.75, bluffFreq: 0.10, looseness: 0.0 },
  lag:      { name: '小K·松凶',    vpip: 0.45, aggression: 0.85, bluffFreq: 0.30, looseness: 0.15 },
  station:  { name: '阿梅·跟注站', vpip: 0.55, aggression: 0.15, bluffFreq: 0.02, looseness: 0.35 },
  nit:      { name: '老周·岩石',   vpip: 0.12, aggression: 0.40, bluffFreq: 0.03, looseness: -0.1 },
  balanced: { name: '林姐·均衡',   vpip: 0.33, aggression: 0.55, bluffFreq: 0.15, looseness: 0.05 },
};

export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'gto';

export interface BotDecision {
  action: ActionType;
  raiseTo?: number;
  think?: string; // 调试用
}

/** 翻牌前手牌强度评分（简化 Chen 公式），返回 0..1 */
function preflopStrength(notation: string): number {
  const m = notation.match(/^([2-9TJQKA])([2-9TJQKA])([so])?$/);
  if (!m) return 0;
  const val = (r: string) => '23456789TJQKA'.indexOf(r) + 2;
  const [, r1s, r2s, so] = m;
  const r1 = val(r1s), r2 = val(r2s);
  if (!so) { // 对子
    return Math.min(1, 0.4 + (r1 - 2) / 12 * 0.6);
  }
  let score = (Math.max(r1, r2) - 2) / 12 * 0.6 + (Math.min(r1, r2) - 2) / 12 * 0.25;
  if (so === 's') score += 0.06;
  const gap = Math.abs(r1 - r2);
  if (gap === 1) score += 0.05; // 连张
  else if (gap === 2) score += 0.02;
  else if (gap >= 4) score -= 0.05;
  return Math.max(0, Math.min(1, score));
}

/** 新手的粗糙牌力感：只认成牌，不算胜率不算赔率 */
function crudeStrength(state: GameState, idx: number): number {
  if (state.street === 'preflop') return preflopStrength(handNotation(state.players[idx].hole[0], state.players[idx].hole[1]));
  const made = evaluate([...state.players[idx].hole, ...state.community]);
  const base = [0.12, 0.42, 0.6, 0.72, 0.8, 0.86, 0.9, 0.94, 0.98, 1][made.category] ?? 0.5;
  return base + (Math.random() - 0.5) * 0.2;
}

/** 牌面湿度：同花/顺子面越湿越不宜诈唬 */
function boardWetness(community: Card[]): number {
  if (community.length < 3) return 0.5;
  const suitCount: Record<string, number> = {};
  for (const c of community) suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCount));
  const ranks = community.map(c => c.rank).sort((a, b) => a - b);
  let maxRun = 1, run = 1;
  for (let i = 1; i < ranks.length; i++) {
    run = ranks[i] - ranks[i - 1] <= 2 ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  let wet = 0.4;
  if (maxSuit >= 3) wet += 0.3;
  if (maxRun >= 3) wet += 0.2;
  return Math.min(1, wet);
}

/** GTO 对手的剥削建模：记录 hero 面对下注时的弃牌率（模块级，跨手累积） */
const heroModel = { faced: 0, folds: 0 };
export function recordHeroFacingBet(folded: boolean) {
  heroModel.faced += 1;
  if (folded) heroModel.folds += 1;
}

export function botDecide(state: GameState, idx: number, style: BotStyle, difficulty: AIDifficulty = 'normal'): BotDecision {
  const p = state.players[idx];
  const la = legalActions(state, idx);
  const opponents = state.players.filter(q => !q.folded && q.id !== p.id).length;
  const potNow = state.players.reduce((sum, q) => sum + q.handBet, 0);
  const toCall = state.currentBet - p.streetBet;

  // 估算强度：新手只认成牌；普通 250 次模拟；高手 400 次；GTO 600 次
  let strength: number; // 0..1
  if (difficulty === 'easy') {
    strength = crudeStrength(state, idx);
  } else if (state.street === 'preflop') {
    strength = preflopStrength(handNotation(p.hole[0], p.hole[1]));
  } else {
    const iters = difficulty === 'gto' ? 600 : difficulty === 'hard' ? 400 : 250;
    const eq = calcEquity(p.hole, state.community, Math.max(opponents, 1), iters);
    strength = eq.equity;
    const made = evaluate([...p.hole, ...state.community]);
    if (made.category >= 3) strength = Math.min(1, strength + 0.1);
  }

  // 风格噪声
  strength += (Math.random() - 0.5) * 0.12 + style.looseness * 0.3;

  // 难度修正
  let aggression = style.aggression;
  let bluffFreq = difficulty === 'easy' ? 0 : style.bluffFreq; // 新手从不诈唬
  let looseness = style.looseness + (difficulty === 'easy' ? 0.15 : 0); // 新手更爱跟

  if (difficulty === 'hard' || difficulty === 'gto') {
    // 位置感知：越靠后越凶
    const n = state.players.length;
    const distFromBtn = (idx - state.dealerIdx + n) % n; // 0=按钮位
    if (distFromBtn === 0 || distFromBtn === 1) aggression += 0.12;      // 按钮/ cutoff
    if (state.street === 'preflop' && toCall === state.bigBlind) looseness += 0.12; // 盲注防守更宽
    // 牌面结构：湿面少诈唬，干面多诈唬
    if (state.street !== 'preflop') {
      const wet = boardWetness(state.community);
      bluffFreq *= wet > 0.7 ? 0.5 : wet < 0.5 ? 1.4 : 1;
    }
  }
  if (difficulty === 'gto' && heroModel.faced >= 10) {
    // 简单剥削：你弃牌多就多诈唬，你跟注多就减少诈唬
    const foldRate = heroModel.folds / heroModel.faced;
    if (foldRate > 0.55) bluffFreq += 0.15;
    else if (foldRate < 0.35) bluffFreq = Math.max(0, bluffFreq - 0.1);
  }

  const rand = Math.random();
  const betSize = (mul: number) =>
    Math.min(Math.max(Math.round(potNow * mul) + state.currentBet, la.minRaiseTo), la.maxRaiseTo);
  // GTO 极化尺度：小注 0.4 底池 / 大注 1.2 底池；其他统一 2/3 底池附近
  const polarSize = () => (Math.random() < 0.5 ? betSize(0.4) : betSize(1.2));
  const stdSize = (mul: number) => (difficulty === 'gto' ? polarSize() : betSize(mul));

  if (toCall > 0) {
    // 面对下注
    const potOdds = difficulty === 'easy'
      ? 0.25 // 新手不算赔率，凭感觉
      : toCall / (potNow + 2 * toCall);
    const adjusted = strength + looseness;
    if (adjusted > 0.75) {
      // 强牌：加注 or 全下
      if (rand < aggression) return { action: 'raise', raiseTo: stdSize(1.0) };
      return { action: 'call' };
    }
    if (adjusted > potOdds + 0.05) {
      // 赔率合适：跟注，偶尔诈唬加注
      if (rand < bluffFreq * aggression) return { action: 'raise', raiseTo: stdSize(0.8) };
      return { action: 'call' };
    }
    // 新手错误注入：该弃的牌有 25% 概率照样跟
    if (difficulty === 'easy' && Math.random() < 0.25 && toCall <= p.chips) {
      return { action: 'call' };
    }
    // 弱牌：偶尔诈唬
    if (rand < bluffFreq * 0.5 && opponents <= 2) {
      return { action: 'raise', raiseTo: stdSize(0.75) };
    }
    return { action: 'fold' };
  }

  // 无人下注
  if (state.street === 'preflop') {
    const threshold = 1 - style.vpip - 0.35 - (difficulty === 'easy' ? 0.08 : 0);
    if (strength > threshold) {
      if (rand < aggression + 0.2) {
        return { action: 'raise', raiseTo: Math.min(state.bigBlind * 3, la.maxRaiseTo) };
      }
      if (la.canCall) return { action: 'call' };
      return { action: 'check' };
    }
    if (la.canCheck) return { action: 'check' };
    return { action: 'fold' };
  }

  // 翻牌后无人下注
  if (strength > 0.6 && rand < aggression + 0.25) {
    return { action: 'bet', raiseTo: stdSize(0.66) };
  }
  if (strength > 0.4 && rand < aggression * 0.5) {
    return { action: 'bet', raiseTo: stdSize(0.5) };
  }
  // 诈唬
  if (rand < bluffFreq && opponents <= 3) {
    return { action: 'bet', raiseTo: stdSize(0.6) };
  }
  return { action: 'check' };
}
