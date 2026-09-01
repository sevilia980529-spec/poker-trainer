// ============================================================
// shared/types.ts —— 前后端唯一契约源（服务端 + 前端共用）
// ⚠️ 本文件只允许出现 interface / type，禁止 const / enum / class /
//    任何运行时代码。server/ 必须用 `import type` 引入，
//    esbuild 会 100% 擦除，不会把前端代码打进 server bundle。
//
// 契约来源：docs/ARCH-账号系统.md §3.1（严格照抄，禁止自行增删字段，
//          前端工程师按同一份契约并行开发）
// ============================================================

/* ---------- 通用响应包 ---------- */
export type ApiErrorCode =
  | 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'NICKNAME_INVALID'
  | 'EMAIL_TAKEN' | 'INVALID_CREDENTIALS' | 'UNAUTHORIZED'
  | 'WRONG_PASSWORD' | 'RATE_LIMITED'
  | 'CLOUD_DISABLED' | 'NOT_IMPLEMENTED'
  | 'REVISION_CONFLICT' | 'ALREADY_MIGRATED'
  | 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE' | 'AVATAR_TOO_LARGE'
  | 'INTERNAL' | 'NETWORK' | 'TIMEOUT';

export interface ApiError { code: ApiErrorCode; message: string; details?: unknown }

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/* ---------- 用户 ---------- */
/** 云端用户资料（**永不含 password_hash**） */
export interface CloudUser {
  id: string;                 // uuid
  email: string;              // 已 trim + lowercase
  nickname: string;           // ≤12 字符
  avatar: string;             // '/avatars/1.png' 或 dataURL
  createdAt: string;          // ISO
  updatedAt: string;          // ISO，昵称/头像 LWW 依据
  migratedAt: string | null;
  emailVerified: boolean;
}

/* ---------- 进度快照（14 个标量与 PRD §5.2 一一对应） ---------- */
export interface CategoryStat { answered: number; correct: number }

export interface ProgressSnapshot {
  // 增量累计型 ACCUM
  xp: number;
  points: number;
  handsPlayed: number;
  handsWon: number;
  totalProfit: number;
  excellentActions: number;
  mistakes: number;
  drillAnswered: number;
  drillCorrect: number;
  // 峰值型 PEAK
  biggestPot: number;
  drillBestStreak: number;
  // LWW 状态型
  drillStreak: number;
  // 签到型 CHECKIN
  lastDailyCheckin: number;       // ms epoch
  consecutiveLoginDays: number;
  // 分项正确数
  drillPerCategory: Record<string, CategoryStat>;
}

/* ---------- 同步：本地 → 云端 ---------- */
export type AccumField =
  | 'xp' | 'points' | 'handsPlayed' | 'handsWon' | 'totalProfit'
  | 'excellentActions' | 'mistakes' | 'drillAnswered' | 'drillCorrect';
export type PeakField = 'biggestPot' | 'drillBestStreak';

export interface SyncPushRequest {
  baseRevision: number;
  /** 仅提交**有变化**的累加字段的差值：current − base */
  delta: Partial<Record<AccumField, number>>;
  /** 仅提交**变大**了的峰值字段的本地绝对值 */
  peak: Partial<Record<PeakField, number>>;
  /** 仅提交有变化的分项差值 */
  perCategoryDelta: Record<string, Partial<CategoryStat>>;
  /** 仅当本地签到状态相对 base 有变化时提交 */
  checkin: { lastDailyCheckin: number; consecutiveLoginDays: number } | null;
  /** 仅当 drillStreak 相对 base 有变化时提交 */
  lww: { drillStreak: number; clientUpdatedAt: number } | null;
}

export interface SyncPushResponse {
  snapshot: ProgressSnapshot;   // 合并后的云端最新值
  revision: number;
}
/** 409 时的 data 载荷 */
export interface SyncConflictPayload {
  snapshot: ProgressSnapshot;   // 云端最新值
  revision: number;             // 云端最新 revision
}

export interface SyncPullResponse {
  user: CloudUser;
  snapshot: ProgressSnapshot;
  revision: number;
}

/* ---------- 迁移 ---------- */
export type MigrateStrategy = 'merge' | 'overwrite' | 'keep_cloud';

export interface MigrateRequest {
  strategy: MigrateStrategy;
  /** 本机全量快照（相对 ZERO_BASELINE） */
  snapshot: ProgressSnapshot;
  /** 本机昵称/头像，供 LWW 决策 */
  profile: { nickname: string; avatar: string };
  clientUpdatedAt: number;
}

export interface MigrateResponse {
  snapshot: ProgressSnapshot;
  revision: number;
  user: CloudUser;
  alreadyMigrated: boolean;     // true = 此前已迁移过，本次未做任何合并
}

/* ---------- 认证 ---------- */
export interface RegisterRequest { email: string; password: string; nickname?: string }
export interface LoginRequest { email: string; password: string }
export interface LogoutResponse { ok: true }

export interface AuthSessionResponse {
  user: CloudUser;
  snapshot: ProgressSnapshot;
  revision: number;
}

export interface UpdateProfileRequest { nickname?: string; avatar?: string }

/* ---------- 健康检查 ---------- */
export interface HealthResponse { ok: true; cloud: boolean; ts: number }
