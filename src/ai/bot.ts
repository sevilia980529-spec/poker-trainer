// AI 对手：多风格 bot 决策
import type { GameState, ActionType } from '../engine/game';
import { legalActions } from '../engine/game';
import { calcEquity } from '../engine/equity';
import { evaluate } from '../engine/evaluate';
import { handNotation } from '../engine/cards';

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

export function botDecide(state: GameState, idx: number, style: BotStyle): BotDecision {
  const p = state.players[idx];
  const la = legalActions(state, idx);
  const opponents = state.players.filter(q => !q.folded && q.id !== p.id).length;
  const potNow = state.players.reduce((sum, q) => sum + q.handBet, 0);
  const toCall = state.currentBet - p.streetBet;

  // 估算强度
  let strength: number; // 0..1
  if (state.street === 'preflop') {
    strength = preflopStrength(handNotation(p.hole[0], p.hole[1]));
  } else {
    const iters = 250; // AI 用较少迭代保证速度
    const eq = calcEquity(p.hole, state.community, Math.max(opponents, 1), iters);
    strength = eq.equity;
    // 成牌额外加成（模拟价值下注意愿）
    const made = evaluate([...p.hole, ...state.community]);
    if (made.category >= 3) strength = Math.min(1, strength + 0.1);
  }
  // 风格噪声
  strength += (Math.random() - 0.5) * 0.12 + style.looseness * 0.3;

  const rand = Math.random();
  const betSize = (mul: number) =>
    Math.min(Math.max(Math.round(potNow * mul) + state.currentBet, la.minRaiseTo), la.maxRaiseTo);

  if (toCall > 0) {
    // 面对下注
    const potOdds = toCall / (potNow + 2 * toCall);
    const adjusted = strength + style.looseness;
    if (adjusted > 0.75) {
      // 强牌：加注 or 全下
      if (rand < style.aggression) return { action: 'raise', raiseTo: betSize(1.0) };
      return { action: 'call' };
    }
    if (adjusted > potOdds + 0.05) {
      // 赔率合适：跟注，偶尔诈唬加注
      if (rand < style.bluffFreq * style.aggression) return { action: 'raise', raiseTo: betSize(0.8) };
      return { action: 'call' };
    }
    // 弱牌：偶尔诈唬
    if (rand < style.bluffFreq * 0.5 && opponents <= 2) {
      return { action: 'raise', raiseTo: betSize(0.75) };
    }
    return { action: 'fold' };
  }

  // 无人下注
  if (state.street === 'preflop') {
    const threshold = 1 - style.vpip - 0.35;
    if (strength > threshold) {
      if (rand < style.aggression + 0.2) {
        return { action: 'raise', raiseTo: Math.min(state.bigBlind * 3, la.maxRaiseTo) };
      }
      if (la.canCall) return { action: 'call' };
      return { action: 'check' };
    }
    if (la.canCheck) return { action: 'check' };
    return { action: 'fold' };
  }

  // 翻牌后无人下注
  if (strength > 0.6 && rand < style.aggression + 0.25) {
    return { action: 'bet', raiseTo: betSize(0.66) };
  }
  if (strength > 0.4 && rand < style.aggression * 0.5) {
    return { action: 'bet', raiseTo: betSize(0.5) };
  }
  // 诈唬
  if (rand < style.bluffFreq && opponents <= 3) {
    return { action: 'bet', raiseTo: betSize(0.6) };
  }
  return { action: 'check' };
}
