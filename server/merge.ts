// ============================================================
// server/merge.ts —— 字段合并矩阵（ARCH §6.5）
//
// 设计原则：
//   · 纯函数、零 I/O —— 可脱离网络用 `node --test` 单测
//   · 合并逻辑写在 TS 而不是 SQL RPC：改矩阵不用跑迁移、可单测，
//     原子性由 PostgREST 条件 PATCH（CAS）保证
//   · 任何来自客户端的数值都先 clamp，杜绝脏数据污染数据库
// ============================================================
import {
  ACCUM_FIELDS,
  DEFAULT_AVATAR,
  DEFAULT_NICKNAME,
  PEAK_FIELDS,
  ZERO_BASELINE,
  dayIndex,
} from '../shared/constants';
import type {
  AccumField,
  CategoryStat,
  MigrateRequest,
  PeakField,
  ProgressSnapshot,
  SyncPushRequest,
} from '../shared/types';
import type { ProgressRow } from './types';

/* ---------------- 数值边界（防御性 clamp） ---------------- */
const MAX_INT32 = 1_000_000_000;      // int4 列的安全上界
const MAX_BIG = 1_000_000_000_000;    // int8 列的安全上界
const MAX_STREAK = 1_000_000;
const MAX_CATEGORY_VALUE = 10_000_000;
const MAX_CATEGORY_KEYS = 60;
const MAX_DAYS = 3650;

/** 取整 + 夹逼；非有限数一律返回下界（防 NaN / Infinity 落库） */
export function clampInt(v: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

/* ---------------- 签到合并（CHECKIN） ---------------- */
export interface CheckinState {
  lastDailyCheckin: number;
  consecutiveLoginDays: number;
}

/**
 * 签到合并：last 取 max、days 取 max，未来时间戳收敛到 now（防改系统时间）。
 *
 * 为什么 max 就够防重复领取：设备 A 今日已签（last=今天, days=5），
 * 设备 B 数据陈旧（last=昨天, days=4），B 本地允许再签一次 → B 变 (今天, 5)。
 * 上报后 max(last)=今天、max(days)=5 → 云端仍是 5，不会变 6。
 */
export function mergeCheckin(
  cloud: CheckinState,
  inc: CheckinState | null,
  now: number,
): CheckinState {
  const cloudLast = clampInt(cloud?.lastDailyCheckin ?? 0, 0, Number.MAX_SAFE_INTEGER);
  const cloudDays = clampInt(cloud?.consecutiveLoginDays ?? 0, 0, MAX_DAYS);
  if (!inc) return { lastDailyCheckin: cloudLast, consecutiveLoginDays: cloudDays };

  let last = Math.max(cloudLast, clampInt(inc.lastDailyCheckin ?? 0, 0, Number.MAX_SAFE_INTEGER));
  if (dayIndex(last) > dayIndex(now)) last = now;              // 未来时间 → 收敛
  let days = Math.max(cloudDays, clampInt(inc.consecutiveLoginDays ?? 0, 0, MAX_DAYS));
  if (last === 0) days = 0;
  return { lastDailyCheckin: last, consecutiveLoginDays: clampInt(days, 0, MAX_DAYS) };
}

/* ---------------- 分项正确数（PER_CATEGORY） ---------------- */
/** 逐 key 增量累加：最多 50 个新 key、key 长度 ≤40、值 ≤1e7 */
export function mergePerCategory(
  cloud: Record<string, CategoryStat>,
  delta: Record<string, Partial<CategoryStat>> = {},
): Record<string, CategoryStat> {
  const out: Record<string, CategoryStat> = { ...(cloud ?? {}) };
  let budget = 50;
  for (const [k, d] of Object.entries(delta ?? {})) {
    if (typeof k !== 'string' || k.length === 0 || k.length > 40) continue;
    if (budget-- <= 0) break;
    const c = out[k] ?? { answered: 0, correct: 0 };
    const a = clampInt(c.answered + clampInt(d?.answered ?? 0, -MAX_CATEGORY_VALUE, MAX_CATEGORY_VALUE), 0, MAX_CATEGORY_VALUE);
    let r = clampInt(c.correct + clampInt(d?.correct ?? 0, -MAX_CATEGORY_VALUE, MAX_CATEGORY_VALUE), 0, MAX_CATEGORY_VALUE);
    if (r > a) r = a;                       // 正确数不可能超过已答数
    out[k] = { answered: a, correct: r };
  }
  // 总 key 数上限保护
  const keys = Object.keys(out);
  if (keys.length > MAX_CATEGORY_KEYS) {
    for (const k of keys.slice(MAX_CATEGORY_KEYS)) delete out[k];
  }
  return out;
}

/* ---------------- 快照级合并（纯函数，单测主入口） ---------------- */
export interface SnapshotMergeResult {
  snapshot: ProgressSnapshot;
  /** 新的 client_updated_at（ISO 字符串）：仅当本次 LWW 生效时才前移 */
  clientUpdatedAt: string;
}

/**
 * 把一次 push 的增量应用到云端快照上。
 *
 * @param cloud 云端当前快照
 * @param p     客户端提交的请求（delta 是「相对 base 的差值」，不是绝对值）
 * @param now   服务端当前时间戳（ms）
 * @param cloudClientUpdatedAt 云端 client_updated_at（ISO），drillStreak 的 LWW 依据
 */
export function mergeSnapshot(
  cloud: ProgressSnapshot,
  p: SyncPushRequest,
  now: number,
  cloudClientUpdatedAt: string,
): SnapshotMergeResult {
  const out: ProgressSnapshot = {
    ...cloud,
    drillPerCategory: { ...(cloud.drillPerCategory ?? {}) },
  };

  /* ① 增量累加型 ACCUM：cloud + delta */
  for (const f of ACCUM_FIELDS) {
    const d = p.delta?.[f];
    if (typeof d === 'number' && Number.isFinite(d)) {
      out[f] = (out[f] ?? 0) + Math.trunc(d);
    }
  }

  /* ② 峰值型 PEAK：max */
  for (const f of PEAK_FIELDS) {
    const v = p.peak?.[f];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[f] = Math.max(out[f] ?? 0, Math.trunc(v));
    }
  }

  /* ③ 分项正确数：逐 key 累加 */
  out.drillPerCategory = mergePerCategory(cloud.drillPerCategory ?? {}, p.perCategoryDelta ?? {});

  /* ④ 签到型：max + 重算 */
  const ck = mergeCheckin(
    {
      lastDailyCheckin: cloud.lastDailyCheckin,
      consecutiveLoginDays: cloud.consecutiveLoginDays,
    },
    p.checkin ?? null,
    now,
  );
  out.lastDailyCheckin = ck.lastDailyCheckin;
  out.consecutiveLoginDays = ck.consecutiveLoginDays;

  /* ⑤ LWW：drillStreak，clientUpdatedAt 较新者胜 */
  let clientUpdatedAt = cloudClientUpdatedAt;
  if (p.lww && Number.isFinite(p.lww.clientUpdatedAt)) {
    const cloudTsNum = Date.parse(cloudClientUpdatedAt);
    const cloudTs = Number.isFinite(cloudTsNum) ? cloudTsNum : 0;
    if (p.lww.clientUpdatedAt >= cloudTs) {
      out.drillStreak = clampInt(p.lww.drillStreak, 0, MAX_STREAK);
      clientUpdatedAt = new Date(p.lww.clientUpdatedAt).toISOString();
    }
  }

  /* ⑥ 防御性 clamp：杜绝脏数据污染 */
  out.xp = clampInt(out.xp, 0, MAX_INT32);
  out.points = clampInt(out.points, 0, MAX_BIG);
  out.handsPlayed = clampInt(out.handsPlayed, 0, MAX_INT32);
  if (out.handsWon > out.handsPlayed) out.handsWon = out.handsPlayed;
  out.handsWon = clampInt(out.handsWon, 0, MAX_INT32);
  out.totalProfit = clampInt(out.totalProfit, -MAX_BIG, MAX_BIG);
  out.excellentActions = clampInt(out.excellentActions, 0, MAX_INT32);
  out.mistakes = clampInt(out.mistakes, 0, MAX_INT32);
  out.drillAnswered = clampInt(out.drillAnswered, 0, MAX_INT32);
  if (out.drillCorrect > out.drillAnswered) out.drillCorrect = out.drillAnswered;
  out.drillCorrect = clampInt(out.drillCorrect, 0, MAX_INT32);
  out.biggestPot = clampInt(out.biggestPot, 0, MAX_BIG);
  out.drillStreak = clampInt(out.drillStreak, 0, MAX_STREAK);
  if (out.drillBestStreak < out.drillStreak) out.drillBestStreak = out.drillStreak;
  out.drillBestStreak = clampInt(out.drillBestStreak, 0, MAX_STREAK);
  out.lastDailyCheckin = clampInt(out.lastDailyCheckin, 0, Number.MAX_SAFE_INTEGER);
  out.consecutiveLoginDays = clampInt(out.consecutiveLoginDays, 0, MAX_DAYS);

  return { snapshot: out, clientUpdatedAt };
}

/* ---------------- 行 ↔ 快照 ---------------- */
/** ProgressRow → ProgressSnapshot */
export function rowToSnapshot(row: ProgressRow): ProgressSnapshot {
  return {
    xp: row.xp,
    points: row.points,
    handsPlayed: row.hands_played,
    handsWon: row.hands_won,
    totalProfit: row.total_profit,
    excellentActions: row.excellent_actions,
    mistakes: row.mistakes,
    drillAnswered: row.drill_answered,
    drillCorrect: row.drill_correct,
    biggestPot: row.biggest_pot,
    drillBestStreak: row.drill_best_streak,
    drillStreak: row.drill_streak,
    lastDailyCheckin: row.last_daily_checkin,
    consecutiveLoginDays: row.consecutive_login_days,
    drillPerCategory: { ...(row.drill_per_category ?? {}) },
  };
}

/** ProgressSnapshot → 行的业务列（不含 user_id / revision / updated_at / client_updated_at） */
export function snapshotToRow(
  s: ProgressSnapshot,
): Omit<ProgressRow, 'user_id' | 'revision' | 'client_updated_at' | 'updated_at'> {
  return {
    xp: clampInt(s.xp, 0, MAX_INT32),
    points: clampInt(s.points, 0, MAX_BIG),
    hands_played: clampInt(s.handsPlayed, 0, MAX_INT32),
    hands_won: clampInt(s.handsWon, 0, MAX_INT32),
    total_profit: clampInt(s.totalProfit, -MAX_BIG, MAX_BIG),
    excellent_actions: clampInt(s.excellentActions, 0, MAX_INT32),
    mistakes: clampInt(s.mistakes, 0, MAX_INT32),
    drill_answered: clampInt(s.drillAnswered, 0, MAX_INT32),
    drill_correct: clampInt(s.drillCorrect, 0, MAX_INT32),
    biggest_pot: clampInt(s.biggestPot, 0, MAX_BIG),
    drill_best_streak: clampInt(s.drillBestStreak, 0, MAX_STREAK),
    drill_streak: clampInt(s.drillStreak, 0, MAX_STREAK),
    last_daily_checkin: clampInt(s.lastDailyCheckin, 0, Number.MAX_SAFE_INTEGER),
    consecutive_login_days: clampInt(s.consecutiveLoginDays, 0, MAX_DAYS),
    drill_per_category: sanitizePerCategory(s.drillPerCategory),
  };
}

/** 清洗分项正确数：丢弃非法 key/值，并限制总量 */
export function sanitizePerCategory(
  input: unknown,
): Record<string, CategoryStat> {
  const out: Record<string, CategoryStat> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const entries = Object.entries(input as Record<string, unknown>).slice(0, MAX_CATEGORY_KEYS);
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || k.length === 0 || k.length > 40) continue;
    const o = (v ?? {}) as Partial<CategoryStat>;
    const a = clampInt(Number(o.answered ?? 0), 0, MAX_CATEGORY_VALUE);
    let r = clampInt(Number(o.correct ?? 0), 0, MAX_CATEGORY_VALUE);
    if (r > a) r = a;
    out[k] = { answered: a, correct: r };
  }
  return out;
}

/** 把客户端提交的任意对象洗成合法快照（迁移接口用，绝不信任客户端） */
export function sanitizeSnapshot(input: unknown): ProgressSnapshot {
  const o = (input ?? {}) as Partial<ProgressSnapshot>;
  const num = (v: unknown, min: number, max: number): number =>
    clampInt(Number(v ?? 0), min, max);
  const snapshot: ProgressSnapshot = {
    xp: num(o.xp, 0, MAX_INT32),
    points: num(o.points, 0, MAX_BIG),
    handsPlayed: num(o.handsPlayed, 0, MAX_INT32),
    handsWon: num(o.handsWon, 0, MAX_INT32),
    totalProfit: num(o.totalProfit, -MAX_BIG, MAX_BIG),
    excellentActions: num(o.excellentActions, 0, MAX_INT32),
    mistakes: num(o.mistakes, 0, MAX_INT32),
    drillAnswered: num(o.drillAnswered, 0, MAX_INT32),
    drillCorrect: num(o.drillCorrect, 0, MAX_INT32),
    biggestPot: num(o.biggestPot, 0, MAX_BIG),
    drillBestStreak: num(o.drillBestStreak, 0, MAX_STREAK),
    drillStreak: num(o.drillStreak, 0, MAX_STREAK),
    lastDailyCheckin: num(o.lastDailyCheckin, 0, Number.MAX_SAFE_INTEGER),
    consecutiveLoginDays: num(o.consecutiveLoginDays, 0, MAX_DAYS),
    drillPerCategory: sanitizePerCategory(o.drillPerCategory),
  };
  if (snapshot.handsWon > snapshot.handsPlayed) snapshot.handsWon = snapshot.handsPlayed;
  if (snapshot.drillCorrect > snapshot.drillAnswered) {
    snapshot.drillCorrect = snapshot.drillAnswered;
  }
  if (snapshot.drillBestStreak < snapshot.drillStreak) {
    snapshot.drillBestStreak = snapshot.drillStreak;
  }
  return snapshot;
}

/* ---------------- 行级合并（服务端主入口） ---------------- */
/**
 * 把一次 push 应用到云端行上，返回下一版本的行（revision 已 +1）。
 * 调用方随后用 `revision=eq.<旧值>` 条件 PATCH 落库（CAS）。
 */
export function mergeProgress(
  cloud: ProgressRow,
  p: SyncPushRequest,
  now: number,
): ProgressRow {
  const { snapshot, clientUpdatedAt } = mergeSnapshot(
    rowToSnapshot(cloud),
    p,
    now,
    cloud.client_updated_at,
  );
  return {
    ...cloud,
    ...snapshotToRow(snapshot),
    revision: cloud.revision + 1,
    client_updated_at: clientUpdatedAt,
    updated_at: new Date(now).toISOString(),
  };
}

/* ---------------- 迁移三策略（ARCH §6.5） ---------------- */

/** 迁移决策所需的云端资料（来自 users 表的昵称/头像） */
export interface CloudProfile {
  nickname: string;
  avatar: string;
}

export interface MigratePlan {
  /** 合并后的行（revision 已 +1）；skipWrite 为 true 时无意义 */
  row: ProgressRow;
  /** 迁移后应写入 users.nickname 的值 */
  nickname: string;
  /** 迁移后应写入 users.avatar 的值 */
  avatar: string;
  /** keep_cloud：user_progress 一行不改 */
  skipWrite: boolean;
}

/**
 * 计算迁移结果（纯函数，便于单测）。
 *
 * · merge（默认）：把本机快照当作「相对 ZERO_BASELINE 的全量」走一遍增量合并；
 *   昵称/头像仅在云端仍是默认值时才采纳本机值（ARCH §12-Q2）
 * · overwrite：云端整行被本机快照覆盖（revision 仍 +1），昵称/头像直接用本机
 * · keep_cloud：云端一行不改，原样返回（客户端随后 applyRemote 覆盖本地）
 */
export function computeMigrate(
  cloud: ProgressRow,
  cloudProfile: CloudProfile,
  req: MigrateRequest,
  now: number,
): MigratePlan {
  const localSnapshot = sanitizeSnapshot(req.snapshot);
  const nickname = String(req.profile?.nickname ?? '').trim();
  const avatar = String(req.profile?.avatar ?? '').trim();

  if (req.strategy === 'keep_cloud') {
    return {
      row: cloud,
      nickname: cloudProfile.nickname,
      avatar: cloudProfile.avatar,
      skipWrite: true,
    };
  }

  if (req.strategy === 'overwrite') {
    const clientUpdatedAt = Number.isFinite(req.clientUpdatedAt)
      ? new Date(req.clientUpdatedAt).toISOString()
      : new Date(now).toISOString();
    return {
      row: {
        ...cloud,
        ...snapshotToRow(localSnapshot),
        revision: cloud.revision + 1,
        client_updated_at: clientUpdatedAt,
        updated_at: new Date(now).toISOString(),
      },
      nickname: nickname || cloudProfile.nickname,
      avatar: avatar || cloudProfile.avatar,
      skipWrite: false,
    };
  }

  // merge：delta = 本机快照 − ZERO_BASELINE，再走一遍标准增量合并
  const delta: Partial<Record<AccumField, number>> = {};
  for (const f of ACCUM_FIELDS) {
    const d = localSnapshot[f] - ZERO_BASELINE[f];
    if (d !== 0) delta[f] = d;
  }
  const peak: Partial<Record<PeakField, number>> = {
    biggestPot: localSnapshot.biggestPot,
    drillBestStreak: localSnapshot.drillBestStreak,
  };
  const pushReq: SyncPushRequest = {
    baseRevision: cloud.revision,
    delta,
    peak,
    perCategoryDelta: localSnapshot.drillPerCategory,
    checkin: {
      lastDailyCheckin: localSnapshot.lastDailyCheckin,
      consecutiveLoginDays: localSnapshot.consecutiveLoginDays,
    },
    lww: {
      drillStreak: localSnapshot.drillStreak,
      clientUpdatedAt: Number.isFinite(req.clientUpdatedAt) ? req.clientUpdatedAt : now,
    },
  };

  return {
    row: mergeProgress(cloud, pushReq, now),
    nickname: cloudProfile.nickname === DEFAULT_NICKNAME && nickname
      ? nickname
      : cloudProfile.nickname,
    avatar: cloudProfile.avatar === DEFAULT_AVATAR && avatar
      ? avatar
      : cloudProfile.avatar,
    skipWrite: false,
  };
}
