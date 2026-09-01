// ============================================================
// src/lib/api.ts —— 统一 fetch 封装（ARCH §10.1 / T03.1）
//
// 契约：
//   · 永不 throw。任何失败都归一为 { ok:false, error:{ code, message } }
//   · 全部走 AbortController 超时（health 3s / me 2s / 读写 8s）
//   · 全部带 credentials:'include'（会话走 httpOnly cookie，同源无 CORS）
//   · 指数退避重试 1s / 3s / 9s（仅 GET 与 5xx 与网络错误，4xx 不重试）
//   · cloudEnabled === false 时**根本不发请求**（优雅降级 NFR-01）
// ============================================================
import { BACKOFF, TIMEOUT } from '../../shared/constants';
import type {
  ApiError,
  ApiErrorCode,
  ApiResponse,
  AuthSessionResponse,
  CloudUser,
  HealthResponse,
  LoginRequest,
  LogoutResponse,
  MigrateRequest,
  MigrateResponse,
  RegisterRequest,
  SyncConflictPayload,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  UpdateProfileRequest,
} from '../types/cloud';

/* ------------------------------------------------------------------
 * ⚠️ 临时顶替的缺失类型（详见交付报告）
 * ARCH T02.6 要求 POST /api/sync/migrate 支持 profileOverride
 *（'keep_cloud' | 'use_local'，优先级高于 clientUpdatedAt 的 LWW 判定），
 * 但 shared/types.ts 的 MigrateRequest 目前还没有这个字段（该文件归服务端同学）。
 * 这里用局部扩展类型顶上，待 shared/types.ts 补字段后直接删除本声明即可，
 * 调用方无需改动。
 * ------------------------------------------------------------------ */
export interface MigrateRequestWithOverride extends MigrateRequest {
  strategy: MigrateRequest['strategy'];
  /** 一旦传入，覆盖 merge 策略里的昵称/头像 LWW 判定 */
  profileOverride?: 'keep_cloud' | 'use_local';
}

/** HTTP 方法（本项目只用到这四种） */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** 超时毫秒数，缺省 TIMEOUT.RW（8s） */
  timeoutMs?: number;
  /** 退避序列，长度 = 最大重试次数，缺省 [1000, 3000, 9000] */
  retries?: readonly number[];
}

/* ---------------- 云端开关（模块级，由 authStore 驱动） ---------------- */

let cloudEnabled = true;

/**
 * 设置云端可用开关。false 时所有 API 直接返回 CLOUD_DISABLED，
 * 一个网络包都不发（这是「优雅降级」与「调用后失败」的分界线）。
 */
export function setApiCloudEnabled(v: boolean): void {
  cloudEnabled = v;
}

export function isApiCloudEnabled(): boolean {
  return cloudEnabled;
}

/* ---------------- 内部工具 ---------------- */

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function fail<T>(error: ApiError): ApiResponse<T> {
  return { ok: false, error };
}

const DEFAULT_MESSAGE: Partial<Record<ApiErrorCode, string>> = {
  INVALID_EMAIL: '邮箱格式不正确',
  WEAK_PASSWORD: '密码强度不足',
  NICKNAME_INVALID: '昵称不合法（1-12 个字符）',
  EMAIL_TAKEN: '该邮箱已注册，请直接登录',
  INVALID_CREDENTIALS: '邮箱或密码错误',
  UNAUTHORIZED: '登录已过期，请重新登录',
  WRONG_PASSWORD: '原密码错误',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  CLOUD_DISABLED: '云端账号暂未开放',
  NOT_IMPLEMENTED: '功能开发中，敬请期待',
  REVISION_CONFLICT: '进度已被其他设备更新（内部自动重试）',
  ALREADY_MIGRATED: '该账号此前已完成迁移',
  INVALID_JSON: '请求格式有误',
  PAYLOAD_TOO_LARGE: '内容过大，请压缩后重试',
  AVATAR_TOO_LARGE: '头像过大，请压缩后重试',
  INTERNAL: '服务器开小差了，请稍后重试',
  NETWORK: '网络异常，请检查网络后重试',
  TIMEOUT: '请求超时，请稍后重试',
};

/** 取错误码的默认文案（供 store / 组件在拿不到服务端文案时兜底） */
export function errorTextOf(code: ApiErrorCode, fallback?: string): string {
  return fallback ?? DEFAULT_MESSAGE[code] ?? '请求失败，请稍后重试';
}

function messageOf(code: ApiErrorCode, fallback?: string): string {
  return errorTextOf(code, fallback);
}

/** 安全地把响应体解析成 JSON，任何异常都返回 null（绝不 throw） */
async function parseJsonSafely(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 从任意载荷里尽力还原一个 ApiError（兼容 {error:{...}} 与裸 {code,...}） */
function toApiError(payload: unknown, status: number): ApiError {
  if (isRecord(payload)) {
    const inner: unknown = payload.error ?? payload;
    if (isRecord(inner) && typeof inner.code === 'string') {
      const code = inner.code as ApiErrorCode;
      return makeError(
        code,
        messageOf(code, typeof inner.message === 'string' ? inner.message : undefined),
        inner.details,
      );
    }
  }
  const code: ApiErrorCode = status >= 500 ? 'INTERNAL' : 'NETWORK';
  return makeError(code, messageOf(code));
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/* ---------------- 核心 request ---------------- */

/**
 * 统一的 fetch 封装。
 * @returns 永不 reject；网络/超时/解析失败都归一为 ApiResponse
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    timeoutMs = TIMEOUT.RW,
    retries = BACKOFF.NETWORK,
  } = options;

  // ★ 优雅降级：云端未启用时一个包都不发
  if (!cloudEnabled) {
    return fail(makeError('CLOUD_DISABLED', messageOf('CLOUD_DISABLED')));
  }

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await parseJsonSafely(res);
      if (res.ok && isRecord(payload) && payload.ok === true) {
        return payload as ApiResponse<T>;
      }
      const error = toApiError(payload, res.status);
      // 5xx 才重试；4xx（含 401/409）立即返回交给调用方按语义处理
      if (res.status >= 500 && attempt < retries.length) {
        await sleep(retries[attempt]);
        continue;
      }
      return fail(error);
    } catch (e) {
      const code: ApiErrorCode = isAbortError(e) ? 'TIMEOUT' : 'NETWORK';
      const error = makeError(code, messageOf(code));
      if (attempt < retries.length) {
        await sleep(retries[attempt]);
        continue;
      }
      return fail(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ---------------- 各接口 ---------------- */

/** GET /api/health —— 冷启动探活。只重试 2 次（1s/3s），避免冷启动被拖长 */
export function health(): Promise<ApiResponse<HealthResponse>> {
  return request<HealthResponse>('/api/health', {
    method: 'GET',
    timeoutMs: TIMEOUT.HEALTH,
    retries: [1000, 3000],
  });
}

/** POST /api/auth/register —— 注册成功即下发 cookie，等价于自动登录 */
export function register(req: RegisterRequest): Promise<ApiResponse<AuthSessionResponse>> {
  return request<AuthSessionResponse>('/api/auth/register', {
    method: 'POST',
    body: req,
    timeoutMs: TIMEOUT.RW,
  });
}

/** POST /api/auth/login */
export function login(req: LoginRequest): Promise<ApiResponse<AuthSessionResponse>> {
  return request<AuthSessionResponse>('/api/auth/login', {
    method: 'POST',
    body: req,
    timeoutMs: TIMEOUT.RW,
  });
}

/** POST /api/auth/logout */
export function logout(): Promise<ApiResponse<LogoutResponse>> {
  return request<LogoutResponse>('/api/auth/logout', {
    method: 'POST',
    body: {},
    timeoutMs: TIMEOUT.RW,
  });
}

/** GET /api/auth/me —— 不阻塞首屏，故超时仅 2s 且不重试 */
export function me(): Promise<ApiResponse<AuthSessionResponse>> {
  return request<AuthSessionResponse>('/api/auth/me', {
    method: 'GET',
    timeoutMs: TIMEOUT.ME,
    retries: [],
  });
}

/** PUT /api/profile —— 更新昵称/头像（独立通道，不进防抖 push） */
export function updateProfile(
  req: UpdateProfileRequest,
): Promise<ApiResponse<{ user: CloudUser }>> {
  return request<{ user: CloudUser }>('/api/profile', {
    method: 'PUT',
    body: req,
    timeoutMs: TIMEOUT.RW,
  });
}

/** POST /api/sync/push —— 增量上报。409 时 details 携带 SyncConflictPayload */
export function syncPush(req: SyncPushRequest): Promise<ApiResponse<SyncPushResponse>> {
  return request<SyncPushResponse>('/api/sync/push', {
    method: 'POST',
    body: req,
    timeoutMs: TIMEOUT.RW,
    // POST 且 4xx 不重试；409 由 syncEngine 用自己的退避序列处理
    retries: BACKOFF.NETWORK,
  });
}

/** GET /api/sync/pull —— 拉取云端全量（user + snapshot + revision） */
export function syncPull(): Promise<ApiResponse<SyncPullResponse>> {
  return request<SyncPullResponse>('/api/sync/pull', {
    method: 'GET',
    timeoutMs: TIMEOUT.RW,
  });
}

/** POST /api/sync/migrate —— 游客迁移，三策略 + 幂等 */
export function migrate(
  req: MigrateRequestWithOverride,
): Promise<ApiResponse<MigrateResponse>> {
  return request<MigrateResponse>('/api/sync/migrate', {
    method: 'POST',
    body: req,
    timeoutMs: TIMEOUT.RW,
  });
}

/* ---------------- 冲突载荷提取 ---------------- */

/**
 * 从 409 响应里取出 SyncConflictPayload。
 * 服务端把它放在 error.details（见 server/syncRoutes.ts 的 conflictOf）。
 */
export function getConflictPayload(
  res: ApiResponse<unknown>,
): SyncConflictPayload | null {
  if (res.ok) return null;
  if (res.error.code !== 'REVISION_CONFLICT') return null;
  const d: unknown = res.error.details;
  if (isRecord(d) && isRecord(d.snapshot) && typeof d.revision === 'number') {
    return { snapshot: d.snapshot as unknown as SyncConflictPayload['snapshot'], revision: d.revision };
  }
  return null;
}

/** 统一的错误文案出口：UI 可直接展示，已按错误码本地化 */
export function errorMessage(res: ApiResponse<unknown>): string {
  return res.ok ? '' : messageOf(res.error.code, res.error.message);
}
