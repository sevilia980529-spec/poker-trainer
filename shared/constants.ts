// ============================================================
// shared/constants.ts —— 前后端共享的**运行时**常量
// 铁律（ARCH §10.4）：禁止 import 三方包、禁止触碰 DOM / node API。
//   本文件会被打进前端 bundle，也会打进 server bundle，
//   ⚠️ 绝不能在此出现任何密钥或敏感信息。
// ============================================================
import type {
  AccumField,
  CategoryStat,
  PeakField,
  ProgressSnapshot,
} from './types';

/* ---------- 字段合并分类表（ARCH §6.5） ---------- */
/** 增量累计型：cloud = cloud + delta */
export const ACCUM_FIELDS = [
  'xp', 'points', 'handsPlayed', 'handsWon', 'totalProfit',
  'excellentActions', 'mistakes', 'drillAnswered', 'drillCorrect',
] as const;

/** 峰值型：cloud = max(cloud, local) */
export const PEAK_FIELDS = ['biggestPot', 'drillBestStreak'] as const;

/** 驼峰字段 → Postgres 列名 */
export const ACCUM_COL: Record<AccumField, string> = {
  xp: 'xp',
  points: 'points',
  handsPlayed: 'hands_played',
  handsWon: 'hands_won',
  totalProfit: 'total_profit',
  excellentActions: 'excellent_actions',
  mistakes: 'mistakes',
  drillAnswered: 'drill_answered',
  drillCorrect: 'drill_correct',
};

/** 驼峰字段 → Postgres 列名 */
export const PEAK_COL: Record<PeakField, string> = {
  biggestPot: 'biggest_pot',
  drillBestStreak: 'drill_best_streak',
};

/* ---------- 零值基线（迁移 merge 策略的比较基准） ---------- */
export const ZERO_BASELINE: ProgressSnapshot = {
  xp: 0,
  points: 10000,
  handsPlayed: 0,
  handsWon: 0,
  totalProfit: 0,
  excellentActions: 0,
  mistakes: 0,
  drillAnswered: 0,
  drillCorrect: 0,
  biggestPot: 0,
  drillBestStreak: 0,
  drillStreak: 0,
  lastDailyCheckin: 0,
  consecutiveLoginDays: 0,
  drillPerCategory: {},
};

/* ---------- 账号默认值（迁移 merge 策略的 LWW 判定依据，ARCH §12-Q2） ---------- */
export const DEFAULT_NICKNAME = '新玩家';
export const DEFAULT_AVATAR = '/avatars/1.png';

/* ---------- 超时（ms） ---------- */
export const TIMEOUT = {
  /** /api/health：冷启动探测 */
  HEALTH: 3000,
  /** /api/auth/me：不阻塞首屏 */
  ME: 2000,
  /** 读写类（push / pull / migrate / profile / 登录注册） */
  RW: 8000,
} as const;

/* ---------- 退避序列（ms） ---------- */
export const BACKOFF = {
  /** 409 冲突重试 */
  CONFLICT: [300, 900],
  /** 网络错误重试（NFR-02） */
  NETWORK: [1000, 3000, 9000],
} as const;

/* ---------- 限额 ---------- */
export const LIMITS = {
  /** 昵称最大字符数（与 DDL check 一致） */
  NICKNAME_MAX: 12,
  /** 头像 dataURL 最大字节数 */
  AVATAR_MAX: 128 * 1024,
  /** 单次 sync/push payload 上限（NFR-06 要求实测 <8KB，此处为服务端硬顶） */
  PUSH_PAYLOAD_MAX: 64 * 1024,
  /** 密码长度 */
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 64,
  /** 邮箱最大长度 */
  EMAIL_MAX: 254,
} as const;

/** 同步防抖时长（ms） */
export const SYNC_DEBOUNCE_MS = 3000;

/* ---------- localStorage / sessionStorage key（ARCH §10.3） ---------- */
export const LS_KEYS = {
  /** 上次登录用户快照（防首屏闪烁） */
  AUTH_CACHE: 'pm_auth_cache_v1',
  /** 同步基线 {userId, base, revision} */
  SYNC_BASE: 'pm_sync_base_v1',
  /** 游客已选择「直接开始」 */
  GUEST_SEEN: 'pm_guest_seen',
  /** 登录页预填邮箱 */
  LAST_EMAIL: 'pm_last_email_v1',
  /** 迁移弹窗本次会话已忽略（sessionStorage） */
  MIGRATE_DISMISSED: 'pm_migrate_dismissed',
} as const;

/* ---------- 小工具（纯函数，两端共用） ---------- */
/** 分项正确数默认值 */
export const EMPTY_CATEGORY: CategoryStat = { answered: 0, correct: 0 };

/** 判断某快照是否存在非零进度（用于决定是否弹迁移窗） */
export function hasNonZeroProgress(s: ProgressSnapshot): boolean {
  return s.xp > 0 || s.points !== ZERO_BASELINE.points
    || s.drillAnswered > 0 || s.handsPlayed > 0;
}

/** 一天 = 86400000ms；签到按 UTC+8 计算「天」（ARCH §12-Q8） */
export const DAY_MS = 86_400_000;
export const TZ_OFFSET_MS = 8 * 3_600_000;

/** 取某个毫秒时间戳在 UTC+8 时区下的「天序号」 */
export function dayIndex(ts: number): number {
  return Math.floor((ts + TZ_OFFSET_MS) / DAY_MS);
}
