// ============================================================
// server/errors.ts —— 统一错误类型与响应（ARCH §7.4）
// ============================================================
import type { ServerResponse } from 'node:http';
import type { ApiErrorCode } from '../shared/types';

/**
 * 业务异常：携带 HTTP 状态码与前端可识别的错误码。
 * ⚠️ 不用构造器参数属性（`public status: number`），
 *    因为 tsconfig 开启了 erasableSyntaxOnly（禁止非擦除语法），
 *    且该语法在 esbuild / node type-stripping 下也需要额外配置。
 */
export class HttpError extends Error {
  status: number;
  code: ApiErrorCode;
  details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 错误码 → HTTP 状态（ARCH §7.4，前端按 code 分叉，status 仅作传输语义） */
const STATUS: Record<ApiErrorCode, number> = {
  INVALID_EMAIL: 400,
  WEAK_PASSWORD: 400,
  NICKNAME_INVALID: 400,
  AVATAR_TOO_LARGE: 400,
  WRONG_PASSWORD: 400,
  INVALID_JSON: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  EMAIL_TAKEN: 409,
  REVISION_CONFLICT: 409,
  ALREADY_MIGRATED: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  CLOUD_DISABLED: 503,
  INTERNAL: 500,
  NETWORK: 502,
  TIMEOUT: 504,
};

/** 按错误码构造 HttpError（状态码自动查表，避免两处漂移） */
export function httpError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): HttpError {
  return new HttpError(STATUS[code], code, message, details);
}

/** 写 JSON 响应（统一 no-store，避免任何缓存导致的登录态错乱） */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store',
  });
  res.end(s);
}

/** 成功响应：统一包一层 {ok:true, data}（ARCH §3.1 ApiResponse<T>） */
export function sendOk<T>(res: ServerResponse, data: T, status = 200): void {
  sendJson(res, status, { ok: true, data });
}

/**
 * 统一错误响应。
 * ⚠️ 非 HttpError 的异常绝不回传 e.message（可能含 SQL / 密钥片段）。
 */
export function sendError(res: ServerResponse, e: unknown): void {
  if (e instanceof HttpError) {
    if (e.status >= 500) console.error(`[api] ${e.code}: ${e.message}`);
    sendJson(res, e.status, {
      ok: false,
      error: { code: e.code, message: e.message, details: e.details },
    });
    return;
  }
  console.error('[api] unhandled', e);
  sendJson(res, 500, {
    ok: false,
    error: { code: 'INTERNAL' as ApiErrorCode, message: '服务器开小差了，请稍后再试' },
  });
}
