// ============================================================
// src/lib/localSnapshot.ts —— 三源读写中枢（ARCH §6.6 / T03.5）
//
// 三源 = userStore（xp / 签到）+ points（对局数据）+ drillStats（答题数据）
// 本文件是「本机进度」的唯一汇总口径，syncEngine 只通过它读写本地。
//
// ⚠️ 约定：
//   · writeLocalSnapshot 写本地时**不会**触发同步通知（内部走 saveProfileRaw /
//     writeDrillStatsRaw），但 useUserStore.setState 会触发 zustand 订阅，
//     因此调用方仍需用 syncEngine 的 suppress 包裹（红线②）。
//   · 云端下发的快照可能缺字段，统一走 normalizeSnapshot 兜底，
//     避免 undefined 污染本地三源。
// ============================================================
import { ZERO_BASELINE } from '../../shared/constants';
import type { CategoryStat, ProgressSnapshot } from '../types/cloud';
import { loadDrillStats, writeDrillStatsRaw } from '../store/drillStats';
import { loadProfile, saveProfileRaw } from '../store/points';
import { useUserStore } from '../store/userStore';

/** 一个「全零」的纯净快照（深拷贝，避免调用方改到 ZERO_BASELINE） */
export function emptySnapshot(): ProgressSnapshot {
  return { ...ZERO_BASELINE, drillPerCategory: {} };
}

/**
 * 把任意来源（云端 JSON / localStorage）的对象规整成合法的 ProgressSnapshot。
 * 缺字段回落零值基线，非数字回落 0，perCategory 逐项过滤。
 */
export function normalizeSnapshot(input: unknown): ProgressSnapshot {
  const src: Record<string, unknown> =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  const perCategory: Record<string, CategoryStat> = {};
  const rawCat: unknown = src.drillPerCategory;
  if (typeof rawCat === 'object' && rawCat !== null) {
    for (const [k, v] of Object.entries(rawCat as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const item = v as Record<string, unknown>;
      perCategory[k] = {
        answered: Math.max(0, Math.trunc(num(item.answered, 0))),
        correct: Math.max(0, Math.trunc(num(item.correct, 0))),
      };
    }
  }

  return {
    xp: num(src.xp, ZERO_BASELINE.xp),
    points: num(src.points, ZERO_BASELINE.points),
    handsPlayed: num(src.handsPlayed, ZERO_BASELINE.handsPlayed),
    handsWon: num(src.handsWon, ZERO_BASELINE.handsWon),
    totalProfit: num(src.totalProfit, ZERO_BASELINE.totalProfit),
    excellentActions: num(src.excellentActions, ZERO_BASELINE.excellentActions),
    mistakes: num(src.mistakes, ZERO_BASELINE.mistakes),
    drillAnswered: num(src.drillAnswered, ZERO_BASELINE.drillAnswered),
    drillCorrect: num(src.drillCorrect, ZERO_BASELINE.drillCorrect),
    biggestPot: num(src.biggestPot, ZERO_BASELINE.biggestPot),
    drillBestStreak: num(src.drillBestStreak, ZERO_BASELINE.drillBestStreak),
    drillStreak: num(src.drillStreak, ZERO_BASELINE.drillStreak),
    lastDailyCheckin: num(src.lastDailyCheckin, ZERO_BASELINE.lastDailyCheckin),
    consecutiveLoginDays: num(src.consecutiveLoginDays, ZERO_BASELINE.consecutiveLoginDays),
    drillPerCategory: perCategory,
  };
}

/** 读本机三源，汇总成一份 ProgressSnapshot */
export function readLocalSnapshot(): ProgressSnapshot {
  const u = useUserStore.getState();
  const p = loadProfile();
  const d = loadDrillStats();
  return {
    xp: u.xp,
    points: p.points,
    handsPlayed: p.handsPlayed,
    handsWon: p.handsWon,
    totalProfit: p.totalProfit,
    excellentActions: p.excellentActions,
    mistakes: p.mistakes,
    drillAnswered: d.answered,
    drillCorrect: d.correct,
    biggestPot: p.biggestPot,
    drillBestStreak: d.bestStreak,
    drillStreak: d.streak,
    lastDailyCheckin: u.lastDailyCheckin,
    consecutiveLoginDays: u.consecutiveLoginDays,
    drillPerCategory: d.perCategory ?? {},
  };
}

/** 读本机昵称/头像（迁移弹窗 LWW 决策用） */
export function readLocalProfile(): { nickname: string; avatar: string } {
  const u = useUserStore.getState();
  return {
    nickname: typeof u.nickname === 'string' ? u.nickname : '',
    avatar: typeof u.avatar === 'string' ? u.avatar : '',
  };
}

/**
 * 冻结本机进度 + 昵称头像，供迁移弹窗使用。
 *
 * ⚠️ 必须在 applyRemote 之前调用（红线③）：一旦先把云端快照写回本地，
 *    本机进度就被云端默认值冲掉，迁移弹窗会展示一片零。
 */
export function captureLocal(): {
  snapshot: ProgressSnapshot;
  profile: { nickname: string; avatar: string };
} {
  return { snapshot: readLocalSnapshot(), profile: readLocalProfile() };
}

/**
 * 云端快照覆盖本地三源。
 * ⚠️ 调用方必须用 syncEngine 的 suppress 包裹，否则写本地 → 触发上报 → 又写本地。
 */
export function writeLocalSnapshot(s: ProgressSnapshot): void {
  const snap = normalizeSnapshot(s);

  // ① userStore：只改进度镜像字段，绝不碰 accounts / activeId / nickname / avatar
  useUserStore.setState({
    xp: snap.xp,
    lastDailyCheckin: snap.lastDailyCheckin,
    consecutiveLoginDays: snap.consecutiveLoginDays,
  });

  // ② points：保留 createdAt 等本地专属字段
  saveProfileRaw({
    ...loadProfile(),
    points: snap.points,
    handsPlayed: snap.handsPlayed,
    handsWon: snap.handsWon,
    totalProfit: snap.totalProfit,
    excellentActions: snap.excellentActions,
    mistakes: snap.mistakes,
    biggestPot: snap.biggestPot,
  });

  // ③ drillStats
  writeDrillStatsRaw({
    answered: snap.drillAnswered,
    correct: snap.drillCorrect,
    streak: snap.drillStreak,
    bestStreak: snap.drillBestStreak,
    perCategory: snap.drillPerCategory,
  });
}

/** 本机是否有非零进度（决定是否弹迁移窗）。复用 shared/constants 的实现 */
export function hasNonZeroProgress(s: ProgressSnapshot): boolean {
  return (
    s.xp > 0 ||
    s.points !== ZERO_BASELINE.points ||
    s.drillAnswered > 0 ||
    s.handsPlayed > 0
  );
}
