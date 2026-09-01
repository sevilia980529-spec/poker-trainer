// ============================================================
// server/syncRoutes.ts —— /api/sync/push · /pull · /migrate
//
// 并发控制（ARCH §1.1 / §7.5）：
//   PostgREST 条件 PATCH 做 CAS：
//     PATCH /rest/v1/user_progress?user_id=eq.X&revision=eq.N
//     Prefer: return=representation
//   返回空数组 = 条件未命中 = 冲突 → 409（+ 重新读取的最新快照）
//   Postgres 在 READ COMMITTED 下 UPDATE...WHERE 会重新求值 WHERE，天然原子。
//
// ⚠️ 409 时客户端必须「换基准、留增量」（ARCH §6.4），
//    服务端只负责如实返回云端最新快照与 revision。
// ============================================================
import { ACCUM_FIELDS, PEAK_FIELDS } from '../shared/constants';
import type {
  AccumField,
  CategoryStat,
  MigrateRequest,
  MigrateResponse,
  MigrateStrategy,
  PeakField,
  SyncConflictPayload,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '../shared/types';
import { ensureProgress, toCloudUser } from './authRoutes';
import type { Ctx } from './api';
import { isCloudEnabled } from './config';
import { httpError } from './errors';
import {
  computeMigrate,
  mergeProgress,
  rowToSnapshot,
  sanitizeSnapshot,
  snapshotToRow,
} from './merge';
import { sbGet, sbPatch } from './supabase';
import type { ProgressRow, UserRow } from './types';

/** 数值上界（与 server/merge.ts 保持一致） */
const MAX_CATEGORY_VALUE = 10_000_000;
const MAX_STREAK = 1_000_000;
const MAX_DAYS = 3650;
/** 进度写入的 CAS 重试次数（并发极罕见，最多 3 次） */
const MAX_CAS_ATTEMPTS = 3;

function clampIntLocal(v: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return min;
  return Math.min(Math.max(Math.trunc(v), min), max);
}

/** 云端不可用时直接 503（前端静默降级，不弹任何报错） */
function assertCloud(): void {
  if (!isCloudEnabled()) throw httpError('CLOUD_DISABLED', '云端账号服务暂不可用');
}

function requireUserId(ctx: Ctx): string {
  if (!ctx.userId) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');
  return ctx.userId;
}

/** 清洗客户端提交的 push 载荷：任何非法/非有限数值一律剔除，绝不落库 */
export function sanitizePushRequest(body: unknown): SyncPushRequest {
  const o = (body ?? {}) as Partial<SyncPushRequest>;

  const delta: Partial<Record<AccumField, number>> = {};
  const rawDelta = (o.delta ?? {}) as Record<string, unknown>;
  for (const f of ACCUM_FIELDS) {
    const v = rawDelta[f];
    if (typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) !== 0) {
      delta[f] = Math.trunc(v);
    }
  }

  const peak: Partial<Record<PeakField, number>> = {};
  const rawPeak = (o.peak ?? {}) as Record<string, unknown>;
  for (const f of PEAK_FIELDS) {
    const v = rawPeak[f];
    if (typeof v === 'number' && Number.isFinite(v)) peak[f] = Math.trunc(v);
  }

  const perCategoryDelta: Record<string, Partial<CategoryStat>> = {};
  const rawCat = (o.perCategoryDelta ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawCat)) {
    if (typeof k !== 'string' || k.length === 0 || k.length > 40) continue;
    if (!v || typeof v !== 'object') continue;
    const c = v as Partial<CategoryStat>;
    const item: Partial<CategoryStat> = {};
    if (typeof c.answered === 'number' && Number.isFinite(c.answered) && Math.trunc(c.answered) !== 0) {
      item.answered = clampIntLocal(c.answered, -MAX_CATEGORY_VALUE, MAX_CATEGORY_VALUE);
    }
    if (typeof c.correct === 'number' && Number.isFinite(c.correct) && Math.trunc(c.correct) !== 0) {
      item.correct = clampIntLocal(c.correct, -MAX_CATEGORY_VALUE, MAX_CATEGORY_VALUE);
    }
    if (item.answered !== undefined || item.correct !== undefined) perCategoryDelta[k] = item;
  }

  let checkin: SyncPushRequest['checkin'] = null;
  if (o.checkin && typeof o.checkin === 'object') {
    checkin = {
      lastDailyCheckin: clampIntLocal(
        Number(o.checkin.lastDailyCheckin ?? 0), 0, Number.MAX_SAFE_INTEGER,
      ),
      consecutiveLoginDays: clampIntLocal(
        Number(o.checkin.consecutiveLoginDays ?? 0), 0, MAX_DAYS,
      ),
    };
  }

  let lww: SyncPushRequest['lww'] = null;
  if (o.lww && typeof o.lww === 'object') {
    const ts = Number(o.lww.clientUpdatedAt);
    lww = {
      drillStreak: clampIntLocal(Number(o.lww.drillStreak ?? 0), 0, MAX_STREAK),
      clientUpdatedAt: Number.isFinite(ts) ? Math.trunc(ts) : 0,
    };
  }

  return {
    baseRevision: clampIntLocal(Number(o.baseRevision ?? 0), 0, Number.MAX_SAFE_INTEGER),
    delta,
    peak,
    perCategoryDelta,
    checkin,
    lww,
  };
}

/** 构造 409 冲突载荷（云端最新快照 + 最新 revision） */
function conflictOf(row: ProgressRow): SyncConflictPayload {
  return { snapshot: rowToSnapshot(row), revision: row.revision };
}

/** 把合并后的行写成 CAS 补丁体 */
function progressPatch(merged: ProgressRow): Record<string, unknown> {
  return {
    ...snapshotToRow(rowToSnapshot(merged)),
    revision: merged.revision,
    client_updated_at: merged.client_updated_at,
    updated_at: merged.updated_at,
  };
}

/* ============================================================
 * POST /api/sync/push
 * ============================================================ */
export async function push(ctx: Ctx): Promise<void> {
  assertCloud();
  const userId = requireUserId(ctx);

  const payload = sanitizePushRequest(ctx.body);
  const cloud = await ensureProgress(userId);

  // 乐观锁：revision 不匹配 → 直接 409，客户端「换基准、留增量」后重试
  if (cloud.revision !== payload.baseRevision) {
    throw httpError('REVISION_CONFLICT', '进度已被其他设备更新', conflictOf(cloud));
  }

  const merged = mergeProgress(cloud, payload, Date.now());

  // CAS 条件 PATCH：revision 仍是旧值才允许写入
  const rows = await sbPatch<ProgressRow>(
    'user_progress',
    { user_id: `eq.${userId}`, revision: `eq.${cloud.revision}` },
    progressPatch(merged),
  );

  if (rows.length === 0) {
    // 被并发抢先：回读一次最新值，交给客户端按 §6.4 重试
    const fresh = await ensureProgress(userId);
    throw httpError('REVISION_CONFLICT', '进度已被其他设备更新', conflictOf(fresh));
  }

  const res: SyncPushResponse = {
    snapshot: rowToSnapshot(merged),
    revision: merged.revision,
  };
  ctx.ok(res);
}

/* ============================================================
 * GET /api/sync/pull
 * ============================================================ */
export async function pull(ctx: Ctx): Promise<void> {
  assertCloud();
  const userId = requireUserId(ctx);

  const users = await sbGet<UserRow>('users', { id: `eq.${userId}`, select: '*', limit: '1' });
  const user = users[0];
  if (!user) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');

  const progress = await ensureProgress(userId);
  const res: SyncPullResponse = {
    user: toCloudUser(user),
    snapshot: rowToSnapshot(progress),
    revision: progress.revision,
  };
  ctx.ok(res);
}

/* ============================================================
 * POST /api/sync/migrate —— 游客进度迁移（三策略 + 幂等）
 * ============================================================ */
export async function migrate(ctx: Ctx): Promise<void> {
  assertCloud();
  const userId = requireUserId(ctx);

  const body = (ctx.body ?? {}) as Partial<MigrateRequest>;
  const strategy: MigrateStrategy =
    body.strategy === 'overwrite' || body.strategy === 'keep_cloud' ? body.strategy : 'merge';
  const clientUpdatedAt = Number.isFinite(Number(body.clientUpdatedAt))
    ? Math.trunc(Number(body.clientUpdatedAt))
    : Date.now();

  const users = await sbGet<UserRow>('users', { id: `eq.${userId}`, select: '*', limit: '1' });
  const user = users[0];
  if (!user) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');

  let cloud = await ensureProgress(userId);

  /* 幂等其一：此前已迁移过 → 直接返回云端现状，不再做任何合并 */
  if (user.migrated_at) {
    const res: MigrateResponse = {
      snapshot: rowToSnapshot(cloud),
      revision: cloud.revision,
      user: toCloudUser(user),
      alreadyMigrated: true,
    };
    ctx.ok(res);
    return;
  }

  const req: MigrateRequest = {
    strategy,
    snapshot: sanitizeSnapshot(body.snapshot),
    profile: {
      nickname: String(body.profile?.nickname ?? '').trim(),
      avatar: String(body.profile?.avatar ?? '').trim(),
    },
    clientUpdatedAt,
  };

  let plan = computeMigrate(
    cloud,
    { nickname: user.nickname, avatar: user.avatar },
    req,
    Date.now(),
  );

  /* 幂等其二：CAS 占坑 migrated_at（migrated_at is null 才写）。
   * 返回空数组 = 并发下已被另一个请求完成迁移 → 直接按已迁移返回 */
  const claimed = await sbPatch<UserRow>(
    'users',
    { id: `eq.${userId}`, migrated_at: 'is.null' },
    { migrated_at: new Date().toISOString(), nickname: plan.nickname, avatar: plan.avatar },
  );
  if (claimed.length === 0) {
    cloud = await ensureProgress(userId);
    const res: MigrateResponse = {
      snapshot: rowToSnapshot(cloud),
      revision: cloud.revision,
      user: toCloudUser(claimed[0] ?? user),
      alreadyMigrated: true,
    };
    ctx.ok(res);
    return;
  }

  /* 写进度（keep_cloud 策略下 skipWrite，一行不改） */
  if (!plan.skipWrite) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const rows = await sbPatch<ProgressRow>(
        'user_progress',
        { user_id: `eq.${userId}`, revision: `eq.${cloud.revision}` },
        progressPatch(plan.row),
      );
      if (rows.length > 0) { cloud = rows[0]; break; }
      // 被并发抢先：回读最新行，用最新 revision 重算一次
      cloud = await ensureProgress(userId);
      plan = computeMigrate(cloud, { nickname: user.nickname, avatar: user.avatar }, req, Date.now());
      if (plan.skipWrite) break;
    }
  }

  const res: MigrateResponse = {
    snapshot: rowToSnapshot(cloud),
    revision: cloud.revision,
    user: toCloudUser(claimed[0]),
    alreadyMigrated: false,
  };
  ctx.ok(res);
}
