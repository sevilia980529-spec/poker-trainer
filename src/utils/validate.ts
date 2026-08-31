/**
 * 账号体系表单校验工具（PRD AUTH-03）
 *
 * 前后端双重校验：这里的规则必须与服务端实现保持一致。
 * 前端只负责即时反馈，服务端仍会独立再校验一次（前端校验不可信）。
 *
 * 注意：本文件故意放在 src/utils/ 下，不要挪进 shared/types.ts —— 那个文件归服务端同学。
 */

/** 邮箱最大长度（RFC 5321） */
const EMAIL_MAX_LENGTH = 254;

/** 邮箱格式：本地部分 + @ + 域名（至少两段，TLD 至少 2 位字母） */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** 密码长度下限（PRD AUTH-03） */
export const PASSWORD_MIN_LENGTH = 8;

/** 密码长度上限（PRD AUTH-03） */
export const PASSWORD_MAX_LENGTH = 64;

/**
 * 校验邮箱格式。
 * 只判断格式合法性，不判断该邮箱是否已注册（那是服务端的职责）。
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  if (email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_PATTERN.test(email);
}

/** 密码强度等级 */
export type PasswordLevel = 'weak' | 'medium' | 'strong';

/** 密码强度评估结果 */
export interface PasswordStrength {
  level: PasswordLevel;
  /** 原始得分，0–4 */
  score: number;
  /** 中文标签，直接用于 UI 展示 */
  label: string;
}

const STRENGTH_LABEL: Record<PasswordLevel, string> = {
  weak: '弱',
  medium: '中',
  strong: '强',
};

/** 强度配色，PasswordInput 的三格进度条直接复用，避免两处各写一遍色值 */
export const STRENGTH_COLORS: Record<PasswordLevel, string> = {
  weak: '#E53935',
  medium: '#E8C273',
  strong: '#43A047',
};

/** 每档强度点亮的格子数（共 3 格） */
export const STRENGTH_FILLED_CELLS: Record<PasswordLevel, number> = {
  weak: 1,
  medium: 2,
  strong: 3,
};

/**
 * 密码强度评分（PRD AUTH-03）。
 * 计分：长度≥8 记 1 分、含字母 1 分、含数字 1 分、长度≥10 记 1 分，满分 4。
 * 分档：0–1 = weak，2 = medium，3–4 = strong。
 *
 * 注意：本函数只做「强度」评估，不代表「合法性」，
 * 是否可用请用 validatePassword 判断（例如 abcdefgh 评 medium 但缺数字，校验不通过）。
 */
export function checkPasswordStrength(pwd: string): PasswordStrength {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Za-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (pwd.length >= 10) score += 1;

  const level: PasswordLevel = score <= 1 ? 'weak' : score === 2 ? 'medium' : 'strong';
  return { level, score, label: STRENGTH_LABEL[level] };
}

/**
 * 是否为「纯重复字符」，如 aaaaaaaa / 11111111。
 * 判定标准：非空且整串只由同一个字符组成。
 */
function isRepeatedChar(pwd: string): boolean {
  return pwd.length > 0 && new Set(Array.from(pwd)).size === 1;
}

/** 取邮箱 @ 前的本地部分，用于「密码不能与邮箱名相同」校验 */
function emailLocalPart(email: string): string {
  const atIndex = email.indexOf('@');
  return atIndex === -1 ? email : email.slice(0, atIndex);
}

/**
 * 校验密码合法性（PRD AUTH-03）：
 * - 长度 8–64
 * - 必须同时含字母和数字
 * - 不能是纯重复字符
 * - 若传了 email，不能与邮箱前缀（@ 前部分）相同，忽略大小写
 */
export function validatePassword(pwd: string, email?: string): { ok: boolean; reason?: string } {
  if (!pwd) {
    return { ok: false, reason: '请输入密码' };
  }
  if (pwd.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `密码至少 ${PASSWORD_MIN_LENGTH} 位` };
  }
  if (pwd.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `密码最多 ${PASSWORD_MAX_LENGTH} 位` };
  }
  if (!/[A-Za-z]/.test(pwd)) {
    return { ok: false, reason: '密码需包含字母' };
  }
  if (!/\d/.test(pwd)) {
    return { ok: false, reason: '密码需包含数字' };
  }
  if (isRepeatedChar(pwd)) {
    return { ok: false, reason: '密码不能是重复字符' };
  }
  if (email && pwd.toLowerCase() === emailLocalPart(email).trim().toLowerCase()) {
    return { ok: false, reason: '密码不能与邮箱名相同' };
  }
  return { ok: true };
}
