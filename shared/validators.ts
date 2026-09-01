// ============================================================
// shared/validators.ts —— 前后端共用的纯校验函数
// 铁律（ARCH §10.4）：禁止 import 三方包、禁止触碰 DOM / node API。
// 前端用于实时校验，服务端用于二次校验（绝不信任客户端）。
// ============================================================
import { LIMITS } from './constants';

/** 邮箱正则（与 DDL 的 check 约束 `users_email_format` 保持一致） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 归一化邮箱：去空格 + 转小写（注册/登录两端都必须先做这一步） */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

/** 邮箱是否合法 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const e = normalizeEmail(email);
  return e.length > 0 && e.length <= LIMITS.EMAIL_MAX && EMAIL_RE.test(e);
}

export interface PasswordCheck {
  valid: boolean;
  /** 失败原因（中文，可直接展示给用户） */
  reason?: string;
}

/**
 * 密码强度校验：8–64 位、含字母和数字、非全同字符、不等于邮箱前缀。
 * @param pw 原始密码
 * @param email 可选；传入时额外校验「密码不得等于邮箱前缀」
 */
export function validatePassword(pw: string, email?: string): PasswordCheck {
  if (typeof pw !== 'string' || pw.length === 0) {
    return { valid: false, reason: '请输入密码' };
  }
  if (pw.length < LIMITS.PASSWORD_MIN) {
    return { valid: false, reason: `密码至少 ${LIMITS.PASSWORD_MIN} 位` };
  }
  if (pw.length > LIMITS.PASSWORD_MAX) {
    return { valid: false, reason: `密码最多 ${LIMITS.PASSWORD_MAX} 位` };
  }
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return { valid: false, reason: '密码需同时包含字母和数字' };
  }
  if (/^(.)\1*$/.test(pw)) {
    return { valid: false, reason: '密码不能为单一重复字符' };
  }
  if (email) {
    const prefix = normalizeEmail(email).split('@')[0] ?? '';
    if (prefix.length >= 3 && normalizeEmail(pw) === normalizeEmail(email)) {
      return { valid: false, reason: '密码不能与邮箱相同' };
    }
    if (prefix.length >= 3 && pw.toLowerCase() === prefix) {
      return { valid: false, reason: '密码不能与邮箱前缀相同' };
    }
  }
  return { valid: true };
}

export type PasswordLevel = 'weak' | 'medium' | 'strong';

export interface PasswordStrength {
  /** 0–4 分：长度≥8 / 含字母 / 含数字 / 长度≥10 */
  score: number;
  level: PasswordLevel;
}

/** 密码强度：4 项计分 → 0–1 弱 / 2 中 / 3–4 强 */
export function calcPasswordStrength(pw: string): PasswordStrength {
  let score = 0;
  if (typeof pw === 'string' && pw.length >= 8) score += 1;
  if (typeof pw === 'string' && /[a-zA-Z]/.test(pw)) score += 1;
  if (typeof pw === 'string' && /[0-9]/.test(pw)) score += 1;
  if (typeof pw === 'string' && pw.length >= 10) score += 1;
  let level: PasswordLevel = 'weak';
  if (score >= 3) level = 'strong';
  else if (score === 2) level = 'medium';
  return { score, level };
}

/** 昵称：1–12 字符（与 DDL check 一致），去掉首尾空格后判定 */
export function isValidNickname(nickname: string): boolean {
  const n = (nickname ?? '').trim();
  return n.length >= 1 && n.length <= LIMITS.NICKNAME_MAX;
}

/** 头像：要么是站内预设路径，要么是 dataURL，且长度不超上限 */
export function isValidAvatar(avatar: string): boolean {
  if (typeof avatar !== 'string' || avatar.length === 0) return false;
  if (avatar.startsWith('/avatars/') && avatar.length <= 64) return true;
  if (!avatar.startsWith('data:image/')) return false;
  return byteLength(avatar) <= LIMITS.AVATAR_MAX;
}

/** 字符串的 UTF-8 字节长度（dataURL 体积按字节算，不按字符数） */
export function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }  // 代理对算 4 字节
    else n += 3;
  }
  return n;
}
