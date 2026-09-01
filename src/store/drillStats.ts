// 专项训练统计：localStorage 持久化
import type { DrillCategory } from '../ai/drills';

export interface DrillStats {
  answered: number;
  correct: number;
  streak: number;
  bestStreak: number;
  perCategory: Record<string, { answered: number; correct: number }>;
}

const KEY = 'poker-trainer-drill-stats-v1';
export const DRILL_REWARD = 20; // 答对奖励积分

type DrillWriteListener = (() => void) | null;
let onWriteListener: DrillWriteListener = null;

/**
 * 注册训练统计写入监听器（syncEngine 用它感知本地进度变化并触发增量上报）。
 * 传 null 取消。writeLocalSnapshot 走 writeDrillStatsRaw（不触发本监听）。
 */
export function __onWrite(cb: DrillWriteListener): void {
  onWriteListener = cb;
}

/** 原始写库：只落盘，不通知监听器（供本地快照回写使用）。 */
export function writeDrillStatsRaw(stats: DrillStats): void {
  localStorage.setItem(KEY, JSON.stringify(stats));
}

export function loadDrillStats(): DrillStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { answered: 0, correct: 0, streak: 0, bestStreak: 0, perCategory: {} };
}

export function recordAnswer(stats: DrillStats, category: DrillCategory, isCorrect: boolean): DrillStats {
  const next: DrillStats = {
    answered: stats.answered + 1,
    correct: stats.correct + (isCorrect ? 1 : 0),
    streak: isCorrect ? stats.streak + 1 : 0,
    bestStreak: Math.max(stats.bestStreak, isCorrect ? stats.streak + 1 : 0),
    perCategory: {
      ...stats.perCategory,
      [category]: {
        answered: (stats.perCategory[category]?.answered ?? 0) + 1,
        correct: (stats.perCategory[category]?.correct ?? 0) + (isCorrect ? 1 : 0),
      },
    },
  };
  writeDrillStatsRaw(next);
  onWriteListener?.();
  return next;
}
