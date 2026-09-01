// ============================================================
// server/types.ts —— 服务端内部行类型（ARCH §3.2）
// ⚠️ 本文件不导出到前端；字段为 snake_case，与 Postgres 完全一致。
// ============================================================
import type { CategoryStat } from '../shared/types';

/** users 表的行形状 */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  nickname: string;
  avatar: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  migrated_at: string | null;
  token_version: number;
  email_verified: boolean;
}

/** user_progress 表的行形状 */
export interface ProgressRow {
  user_id: string;
  xp: number;
  points: number;
  hands_played: number;
  hands_won: number;
  total_profit: number;
  excellent_actions: number;
  mistakes: number;
  drill_answered: number;
  drill_correct: number;
  biggest_pot: number;
  drill_best_streak: number;
  drill_streak: number;
  last_daily_checkin: number;
  consecutive_login_days: number;
  drill_per_category: Record<string, CategoryStat>;
  revision: number;
  client_updated_at: string;
  updated_at: string;
}

/** HMAC 会话令牌载荷（仅此三项，绝不含密码/邮箱） */
export interface SessionPayload {
  uid: string;   // users.id
  iat: number;   // 签发时间（秒）
  exp: number;   // 过期时间（秒），= iat + 30 天
}
