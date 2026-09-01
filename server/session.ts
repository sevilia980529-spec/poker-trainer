// ============================================================
// server/session.ts —— 无状态会话令牌（ARCH §7.3）
//
// 设计要点：
//   · 严禁内存 session（Render 免费层重启/冷启动即丢）
//   · HMAC-SHA256 签名 + base64url 载荷，载荷仅 {uid, iat, exp}
//   · httpOnly + SameSite=Lax 的 `pm_session` cookie，30 天有效
// ============================================================
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from './config';
import type { SessionPayload } from './types';

const COOKIE = 'pm_session';
/** 30 天 = 2592000 秒 */
const MAX_AGE = 30 * 24 * 3600;

const b64u = (b: Buffer): string => b.toString('base64url');

/** 签发令牌：payload.signature */
export function sign(p: SessionPayload): string {
  const payload = b64u(Buffer.from(JSON.stringify(p), 'utf8'));
  const sig = b64u(
    crypto.createHmac('sha256', getConfig().SESSION_SECRET).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

/** 签发一个 30 天有效的会话令牌 */
export function issue(uid: string): string {
  const iat = Math.floor(Date.now() / 1000);
  return sign({ uid, iat, exp: iat + MAX_AGE });
}

/** 校验令牌：任何一步不合法都返回 null（不抛错，交给调用方转 401） */
export function verifyToken(token: string): SessionPayload | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expect = crypto
    .createHmac('sha256', getConfig().SESSION_SECRET)
    .update(payload)
    .digest();

  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  // timingSafeEqual 在长度不等时会抛错，必须先比长度
  if (given.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(given, expect)) return null;

  try {
    const p = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (!p?.uid || typeof p.exp !== 'number') return null;
    if (p.exp * 1000 < Date.now()) return null;   // 已过期
    return p;
  } catch {
    return null;
  }
}

/** 从请求头里读 pm_session cookie */
export function readCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

/** 读 cookie + 验签，返回载荷或 null */
export function verifySession(req: IncomingMessage): SessionPayload | null {
  const t = readCookie(req);
  return t ? verifyToken(t) : null;
}

function appendSetCookie(res: ServerResponse, value: string): void {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(prev) ? prev : [String(prev)];
  res.setHeader('Set-Cookie', [...list, value]);
}

/** 下发会话 cookie */
export function writeCookie(res: ServerResponse, token: string): void {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ];
  // 本地 http 下不能加 Secure，否则浏览器根本不回传
  if (getConfig().IS_PROD) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

/** 清除会话 cookie（登出 / 会话失效） */
export function clearCookie(res: ServerResponse): void {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (getConfig().IS_PROD) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}
