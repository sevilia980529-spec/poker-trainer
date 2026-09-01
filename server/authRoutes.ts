// ============================================================
// server/authRoutes.ts —— 注册 / 登录 / 登出 / me / 资料 / 找回密码(P1 501)
//
// 安全红线（ARCH §10.5）：
//   · 响应体绝不出现 password_hash（toCloudUser 显式白名单挑字段）
//   · 绝不 console.log 请求体（含明文密码）
//   · 非 HttpError 异常的 e.message 绝不回传客户端
//   · 登录失败统一文案「邮箱或密码错误」，防账号枚举
// ============================================================
import { compare, hash } from 'bcryptjs';
import { DEFAULT_AVATAR, DEFAULT_NICKNAME } from '../shared/constants';
import {
  isValidAvatar,
  isValidEmail,
  isValidNickname,
  normalizeEmail,
  validatePassword,
} from '../shared/validators';
import type {
  AuthSessionResponse,
  CloudUser,
  UpdateProfileRequest,
} from '../shared/types';
import type { Ctx } from './api';
import { isCloudEnabled } from './config';
import { httpError } from './errors';
import { rowToSnapshot } from './merge';
import { issue, clearCookie, writeCookie } from './session';
import { sbGet, sbInsert, sbPatch } from './supabase';
import type { ProgressRow, UserRow } from './types';

/** bcrypt cost = 10（纯 JS 实现，单次约 60~100ms，可接受） */
const BCRYPT_COST = 10;

/**
 * 账号不存在时用于「等时比较」的假哈希（signUp 前随机生成的固定串）。
 * 作用：无论邮箱是否存在，登录耗时量级一致，避免用响应时间探测账号是否注册。
 */
const DUMMY_HASH = '$2b$10$NCRJPvmOVcNtG3csiR45Ae2Ow7XLbfNitwCMCcRnwh4nYjVB.46uC';

/** 统一的登录失败文案（不区分「邮箱不存在」与「密码错误」） */
const INVALID_CREDENTIALS_MSG = '邮箱或密码错误';

/** 用户行 → 前端用户对象（白名单挑字段，password_hash 永不出库） */
export function toCloudUser(row: UserRow): CloudUser {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    migratedAt: row.migrated_at,
    emailVerified: row.email_verified,
  };
}

/** 云端不可用时直接 503（前端静默降级为游客，不弹任何报错） */
function assertCloud(): void {
  if (!isCloudEnabled()) throw httpError('CLOUD_DISABLED', '云端账号服务暂不可用');
}

/** 取请求体（统一转成字典，避免 unknown 上取属性的类型体操） */
function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

/** 兜底用的默认进度行（与 DDL 的默认值一致，永不落库） */
export function defaultProgressRow(userId: string): ProgressRow {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    xp: 0,
    points: 10000,
    hands_played: 0,
    hands_won: 0,
    total_profit: 0,
    excellent_actions: 0,
    mistakes: 0,
    drill_answered: 0,
    drill_correct: 0,
    biggest_pot: 0,
    drill_best_streak: 0,
    drill_streak: 0,
    last_daily_checkin: 0,
    consecutive_login_days: 0,
    drill_per_category: {},
    revision: 0,
    client_updated_at: now,
    updated_at: now,
  };
}

/** 读取进度行；不存在则补建默认行（注册后理论上一定存在） */
export async function ensureProgress(userId: string): Promise<ProgressRow> {
  const rows = await sbGet<ProgressRow>('user_progress', {
    user_id: `eq.${userId}`,
    select: '*',
  });
  if (rows.length > 0) return rows[0];
  const created = await sbInsert<ProgressRow>('user_progress', { user_id: userId });
  if (created.length > 0) return created[0];
  throw httpError('INTERNAL', '进度初始化失败');
}

/** 组装「用户 + 快照 + revision」的登录态响应体 */
function sessionPayload(user: UserRow, progress: ProgressRow): AuthSessionResponse {
  return {
    user: toCloudUser(user),
    snapshot: rowToSnapshot(progress),
    revision: progress.revision,
  };
}

/* ============================================================
 * POST /api/auth/register
 * ============================================================ */
export async function register(ctx: Ctx): Promise<void> {
  assertCloud();
  const b = body(ctx);

  const email = normalizeEmail(String(b.email ?? ''));
  const password = String(b.password ?? '');
  const rawNickname = b.nickname;
  const nickname = rawNickname === undefined || rawNickname === null
    ? DEFAULT_NICKNAME
    : String(rawNickname).trim();

  if (!isValidEmail(email)) throw httpError('INVALID_EMAIL', '邮箱格式不正确');
  const pw = validatePassword(password, email);
  if (!pw.valid) throw httpError('WEAK_PASSWORD', pw.reason ?? '密码强度不足');
  if (!isValidNickname(nickname)) {
    throw httpError('NICKNAME_INVALID', `昵称需 1~12 个字符`);
  }

  const passwordHash = await hash(password, BCRYPT_COST);

  // 不先查后插：直接依赖 users_email_lower_uidx 唯一索引判重（无竞态）
  const users = await sbInsert<UserRow>('users', {
    email,
    password_hash: passwordHash,
    nickname,
    avatar: DEFAULT_AVATAR,
  });
  const user = users[0];
  if (!user) throw httpError('INTERNAL', '注册失败，请稍后重试');

  /* 初始化进度行（默认 10000 欢乐豆由 DDL 的 default 提供）。
   * 账号已插入成功，所以这里失败**不能**让注册整体失败
   * （否则用户重试注册只会收到 EMAIL_TAKEN）。降级为默认行，
   * 后续登录 / push / pull 都会经 ensureProgress 再次补建。 */
  let progress: ProgressRow;
  try {
    progress = await ensureProgress(user.id);
  } catch (e) {
    console.error('[auth] 初始化进度行失败，降级为默认快照', e);
    progress = defaultProgressRow(user.id);
  }

  writeCookie(ctx.res, issue(user.id));
  ctx.ok(sessionPayload(user, progress));
}

/* ============================================================
 * POST /api/auth/login
 * ============================================================ */
export async function login(ctx: Ctx): Promise<void> {
  assertCloud();
  const b = body(ctx);

  const email = normalizeEmail(String(b.email ?? ''));
  const password = String(b.password ?? '');
  if (!email || !password) {
    throw httpError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MSG);
  }

  const users = await sbGet<UserRow>('users', {
    email: `eq.${email}`,
    select: '*',
    limit: '1',
  });
  const user = users[0];

  if (!user) {
    // 等时比较：即便账号不存在也消耗一次 bcrypt
    await compare(password, DUMMY_HASH).catch(() => false);
    throw httpError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MSG);
  }

  const ok = await compare(password, user.password_hash).catch(() => false);
  if (!ok) throw httpError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MSG);

  const progress = await ensureProgress(user.id);

  // 登录时间不影响登录结果：失败也无所谓，异步不阻塞
  void sbPatch<UserRow>('users', { id: `eq.${user.id}` }, {
    last_login_at: new Date().toISOString(),
  }).catch((e) => console.error('[auth] 更新 last_login_at 失败', e));

  writeCookie(ctx.res, issue(user.id));
  ctx.ok(sessionPayload(user, progress));
}

/* ============================================================
 * POST /api/auth/logout
 * ============================================================ */
export async function logout(ctx: Ctx): Promise<void> {
  clearCookie(ctx.res);
  ctx.ok({ ok: true } as const);
}

/* ============================================================
 * GET /api/auth/me
 * ============================================================ */
export async function me(ctx: Ctx): Promise<void> {
  assertCloud();
  const userId = ctx.userId;
  if (!userId) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');

  const users = await sbGet<UserRow>('users', { id: `eq.${userId}`, select: '*', limit: '1' });
  const user = users[0];
  if (!user) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');

  const progress = await ensureProgress(user.id);
  ctx.ok(sessionPayload(user, progress));
}

/* ============================================================
 * PUT /api/profile —— 昵称 / 头像（不混进 sync/push，
 *                     因为头像 dataURL ≤128KB 会撑爆 payload 上限）
 * ============================================================ */
export async function updateProfile(ctx: Ctx): Promise<void> {
  assertCloud();
  const userId = ctx.userId;
  if (!userId) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');

  const body = (ctx.body ?? {}) as UpdateProfileRequest;
  const patch: Record<string, unknown> = {};

  if (body.nickname !== undefined) {
    const nickname = String(body.nickname).trim();
    if (!isValidNickname(nickname)) {
      throw httpError('NICKNAME_INVALID', `昵称需 1~12 个字符`);
    }
    patch.nickname = nickname;
  }

  if (body.avatar !== undefined) {
    const avatar = String(body.avatar);
    if (!isValidAvatar(avatar)) {
      throw httpError('AVATAR_TOO_LARGE', '头像不合法或体积超过 128KB');
    }
    patch.avatar = avatar;
  }

  if (Object.keys(patch).length === 0) {
    // 无变更：直接回当前用户，避免一次无谓写库
    const users = await sbGet<UserRow>('users', { id: `eq.${userId}`, select: '*', limit: '1' });
    const user = users[0];
    if (!user) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');
    ctx.ok(toCloudUser(user));
    return;
  }

  patch.updated_at = new Date().toISOString();
  const rows = await sbPatch<UserRow>('users', { id: `eq.${userId}` }, patch);
  const user = rows[0];
  if (!user) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');
  ctx.ok(toCloudUser(user));
}

/* ============================================================
 * P1 占位：找回密码 / 修改密码 —— 统一 501
 * ============================================================ */
export async function resetRequest(_ctx: Ctx): Promise<void> {
  throw httpError('NOT_IMPLEMENTED', '密码找回功能开发中，敬请期待');
}

export async function resetConfirm(_ctx: Ctx): Promise<void> {
  throw httpError('NOT_IMPLEMENTED', '密码找回功能开发中，敬请期待');
}

export async function changePassword(_ctx: Ctx): Promise<void> {
  throw httpError('NOT_IMPLEMENTED', '修改密码功能开发中，敬请期待');
}

export async function deleteAccount(_ctx: Ctx): Promise<void> {
  throw httpError('NOT_IMPLEMENTED', '注销账号功能开发中，敬请期待');
}
