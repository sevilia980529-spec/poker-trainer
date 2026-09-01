// ============================================================
// server/api.ts —— 裸 node:http 上的 /api/* 路由分发（ARCH §7.1 / §7.2）
//
// 职责：
//   · 判断是否为 /api/* 请求（不是则返回 false，交给静态文件逻辑）
//   · 路由精确匹配 + 登录态校验 + JSON body 解析（分路径大小限制）
//   · 统一错误响应（sendError：非 HttpError 一律不回传原始 message）
//
// 优雅降级（NFR-01）：未配置 Supabase 时 /api/health 返回 cloud:false，
//   其余云端接口返回 503 CLOUD_DISABLED；进程绝不崩溃。
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HealthResponse } from '../shared/types';
import {
  changePassword,
  deleteAccount,
  login,
  logout,
  me,
  register,
  resetConfirm,
  resetRequest,
  updateProfile,
} from './authRoutes';
import { isCloudEnabled } from './config';
import { httpError, sendError, sendOk } from './errors';
import { verifySession } from './session';
import { migrate, pull, push } from './syncRoutes';

/** 处理器上下文 */
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  /** 已解析的 JSON 请求体（GET 为 null） */
  body: unknown;
  /** 登录态用户 id（仅 NEED_AUTH 路由存在） */
  userId?: string;
  query: URLSearchParams;
  /** 成功响应：统一包一层 {ok:true, data} */
  ok: (data: unknown, status?: number) => void;
}

type Handler = (ctx: Ctx) => Promise<void>;

/* ---------------- 路由表（精确匹配，无路径参数） ---------------- */
const ROUTES: Record<string, Handler> = {
  'GET /api/health': health,
  'POST /api/auth/register': register,
  'POST /api/auth/login': login,
  'POST /api/auth/logout': logout,
  'GET /api/auth/me': me,
  'PUT /api/profile': updateProfile,
  'POST /api/auth/password': changePassword,            // P1 AUTH-11
  'POST /api/auth/reset/request': resetRequest,          // P1 → 501
  'POST /api/auth/reset/confirm': resetConfirm,          // P1 → 501
  'DELETE /api/auth/account': deleteAccount,             // P1 AUTH-13
  'GET /api/sync/pull': pull,
  'POST /api/sync/push': push,
  'POST /api/sync/migrate': migrate,
};

/** 分路径的 body 大小上限（字节） */
const BODY_LIMIT: Record<string, number> = {
  default: 16 * 1024,                   // 认证类：足够
  'PUT /api/profile': 320 * 1024,       // 头像 dataURL ≤128KB，base64 膨胀后留足余量
  'POST /api/sync/push': 64 * 1024,
  'POST /api/sync/migrate': 128 * 1024,
};

/** 需要登录态的路由 */
const NEED_AUTH = new Set([
  'GET /api/auth/me',
  'PUT /api/profile',
  'POST /api/auth/password',
  'DELETE /api/auth/account',
  'GET /api/sync/pull',
  'POST /api/sync/push',
  'POST /api/sync/migrate',
]);

/* ---------------- Handlers ---------------- */

/** GET /api/health —— 冷启动探活 + 云端能力声明 */
async function health(ctx: Ctx): Promise<void> {
  const data: HealthResponse = {
    ok: true,
    cloud: isCloudEnabled(),
    ts: Date.now(),
  };
  ctx.ok(data);
}

/** P1 占位：未实现的接口统一 501 */
async function notImplemented(_ctx: Ctx): Promise<void> {
  throw httpError('NOT_IMPLEMENTED', '功能开发中，敬请期待');
}

/* ---------------- JSON body 解析 ---------------- */

/**
 * 超过大小上限时：先给客户端一个**明确的 413 响应**，再断开连接。
 * （直接 req.destroy() 会让客户端只看到「连接被重置」，
 *   前端就分不清是超大 payload 还是网络故障，无法给出「头像过大」的正确提示）
 */
function respondTooLarge(
  req: IncomingMessage,
  res: ServerResponse | undefined,
  limit: number,
): void {
  if (!res || res.writableEnded) return;
  const body = JSON.stringify({
    ok: false,
    error: { code: 'PAYLOAD_TOO_LARGE', message: `请求体超过 ${limit} 字节` },
  });
  res.writeHead(413, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(body);
  // 响应刷出去之后再断开底层连接，不再接收剩余字节
  res.once('finish', () => {
    try { req.destroy(); } catch { /* 已断开则忽略 */ }
  });
}

/**
 * 读取并解析 JSON 请求体。
 * · 超过 limit：回 413 + 断连，绝不把超限数据读进内存
 * · 非 JSON 对象（null / 数组 / 标量）一律判为 INVALID_JSON
 */
export function readJsonBody(
  req: IncomingMessage,
  limit: number,
  res?: ServerResponse,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;                       // 丢弃已收数据，释放内存
        req.pause();                             // 停止继续读取
        respondTooLarge(req, res, limit);
        done(() => reject(httpError('PAYLOAD_TOO_LARGE', `请求体超过 ${limit} 字节`)));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      if (size === 0) return done(() => resolve(null));
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const v: unknown = JSON.parse(raw);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          return done(() => reject(httpError('INVALID_JSON', '请求体必须是 JSON 对象')));
        }
        done(() => resolve(v));
      } catch {
        done(() => reject(httpError('INVALID_JSON', 'JSON 解析失败')));
      }
    });

    req.on('aborted', () => done(() => reject(httpError('INVALID_JSON', '请求体读取中断'))));
    req.on('error', () => done(() => reject(httpError('INVALID_JSON', '请求体读取失败'))));
  });
}

/* ---------------- 分发入口 ---------------- */

/**
 * 处理一个 HTTP 请求。
 * @returns true = 已处理（调用方直接 return）；false = 不是 /api 请求，交给静态文件逻辑
 */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');
  if (!url.pathname.startsWith('/api/')) return false;

  const key = `${req.method ?? 'GET'} ${url.pathname}`;
  const handler = ROUTES[key];
  if (!handler) {
    sendError(res, httpError('NOT_IMPLEMENTED', `未知接口 ${key}`));
    return true;
  }

  try {
    let userId: string | undefined;
    if (NEED_AUTH.has(key)) {
      const p = verifySession(req);
      if (!p) throw httpError('UNAUTHORIZED', '登录已失效，请重新登录');
      userId = p.uid;
    }
    const limit = BODY_LIMIT[key] ?? BODY_LIMIT.default;
    const body = req.method === 'GET' ? null : await readJsonBody(req, limit, res);
    await handler({
      req,
      res,
      body,
      userId,
      query: url.searchParams,
      ok: (data: unknown, status?: number) => sendOk(res, data, status),
    });
  } catch (e) {
    sendError(res, e);
  }
  return true;
}

/** 暴露路由表给 dev 中间件做启动自检（也便于日后加限流/埋点） */
export const API_ROUTES: readonly string[] = Object.keys(ROUTES);

/** 未实现接口的处理器（供外部复用，保持行为一致） */
export { notImplemented };
