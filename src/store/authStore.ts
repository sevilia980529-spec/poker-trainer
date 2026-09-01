// ============================================================
// src/store/authStore.ts —— 云端会话状态（ARCH §3.3 / T03.2）
//
// 职责边界：
//   · 只管「会话态 + 迁移弹窗数据」，不含任何 DOM / 组件逻辑
//   · 登录 / 注册 / 会话恢复三个入口共用同一个 doAuth()，
//     把「captureLocal → 挂起 → applyRemote → start」这条**顺序敏感**
//     的流水线收在一处，避免 UI 同学各写一遍写错顺序（红线③⑥）
//
// ⚠️ 与 syncEngine 构成受控循环依赖：两模块都只在**函数体内**引用对方，
//    ESM live binding 下安全（模块求值期不互相访问）。
// ============================================================
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LS_KEYS } from '../../shared/constants';
import type {
  ApiErrorCode,
  ApiResponse,
  AuthSessionResponse,
  CloudUser,
  LoginRequest,
  ProgressSnapshot,
  RegisterRequest,
  SyncPushRequest,
  UpdateProfileRequest,
} from '../types/cloud';
import * as api from '../lib/api';
import { captureLocal, hasNonZeroProgress } from '../lib/localSnapshot';
import { syncEngine } from '../lib/syncEngine';

/* ---------------- 类型 ---------------- */

/** ARCH §3.3：unknown = 首次判定未完成（冷启动） */
export type AuthStatus = 'unknown' | 'guest' | 'authenticated';

/**
 * ARCH §6.10 / T03.11：同步态 5 态
 *   idle 已同步 · syncing 同步中 · uploaded 已上传待刷新
 *   offline 离线 · unavailable 云端不可用
 */
export type SyncStatus = 'idle' | 'syncing' | 'uploaded' | 'offline' | 'unavailable';

export interface MigratePromptData {
  email: string;
  /** 认证成功瞬间抓的本机快照（冻结值，摘要卡与 merge 策略都用它） */
  localSnapshot: ProgressSnapshot;
  localProfile: { nickname: string; avatar: string };
  cloudSnapshot: ProgressSnapshot;
}

export interface CapturedLocal {
  snapshot: ProgressSnapshot;
  profile: { nickname: string; avatar: string };
}

export interface AuthResult {
  ok: boolean;
  code?: ApiErrorCode;
  error?: string;
  /** 是否需要弹迁移窗（调用方无需自己判，读 store 的 migratePrompt 即可） */
  needsMigrate?: boolean;
  /** 该账号此前已迁移过 */
  alreadyMigrated?: boolean;
}

interface AuthState {
  /* ---- 内存态（不持久化）---- */
  status: AuthStatus;
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  pendingCount: number;
  /** 最近一次算出的待同步增量（供 UI 展示与排查，null = 无待同步） */
  pendingDelta: SyncPushRequest | null;
  /** /api/health 探测是否已结束 */
  healthChecked: boolean;

  /* ---- 持久化态（key: pm_auth_cache_v1）---- */
  user: CloudUser | null;
  cachedAt: number | null;
  /** 上次 /api/health 的结论。初值 true（乐观，避免首屏闪成「不可用」） */
  cloudEnabled: boolean;

  /* ---- 迁移弹窗（内存）---- */
  migratePrompt: (MigratePromptData & { open: boolean }) | null;
  capturedLocal: CapturedLocal | null;

  /* ---- Actions ---- */
  setHealth: (cloudEnabled: boolean) => void;
  setGuest: () => void;
  setAuthenticated: (u: CloudUser) => void;
  setSyncStatus: (s: SyncStatus) => void;
  markSynced: (n?: number) => void;
  setPending: (n: number, delta?: SyncPushRequest | null) => void;
  openMigratePrompt: (p: MigratePromptData) => void;
  closeMigratePrompt: () => void;
  captureLocalNow: () => CapturedLocal;
  clearCapturedLocal: () => void;
  reset: () => void;

  /* ---- 异步 Actions ---- */
  checkHealth: () => Promise<boolean>;
  register: (req: RegisterRequest) => Promise<AuthResult>;
  login: (req: LoginRequest) => Promise<AuthResult>;
  refreshSession: () => Promise<AuthResult>;
  logout: () => Promise<void>;
  updateProfile: (req: UpdateProfileRequest) => Promise<AuthResult>;
  manualSync: () => Promise<{ ok: boolean; error?: string }>;
}

/** 只持久化这三项（其它一律留在内存，刷新即重建） */
type PersistedAuth = Pick<AuthState, 'user' | 'cachedAt' | 'cloudEnabled'>;

/* ---------------- Store ---------------- */

export const useAuthStore = create<AuthState>()(
  persist<AuthState, [], [], PersistedAuth>(
    (set, get) => ({
      status: 'unknown',
      syncStatus: 'idle',
      lastSyncedAt: null,
      pendingCount: 0,
      pendingDelta: null,
      healthChecked: false,

      user: null,
      cachedAt: null,
      cloudEnabled: true,

      migratePrompt: null,
      capturedLocal: null,

      /* ---------------- 基础 setter ---------------- */

      setHealth: (cloudEnabled) => {
        api.setApiCloudEnabled(cloudEnabled);
        set({
          cloudEnabled,
          healthChecked: true,
          syncStatus: cloudEnabled ? get().syncStatus : 'unavailable',
        });
      },

      setGuest: () => {
        set({ status: 'guest', user: null, cachedAt: null, syncStatus: 'idle', pendingCount: 0, pendingDelta: null });
      },

      setAuthenticated: (u) => {
        set({ status: 'authenticated', user: u, cachedAt: Date.now() });
      },

      setSyncStatus: (s) => {
        if (get().syncStatus !== s) set({ syncStatus: s });
      },

      markSynced: (n = 0) => {
        set({ lastSyncedAt: Date.now(), pendingCount: n, pendingDelta: n > 0 ? get().pendingDelta : null });
      },

      setPending: (n, delta = null) => {
        set({
          pendingCount: n,
          pendingDelta: delta ?? (n === 0 ? null : get().pendingDelta),
        });
      },

      openMigratePrompt: (p) => {
        set({
          migratePrompt: {
            open: true,
            email: p.email,
            localSnapshot: p.localSnapshot,
            localProfile: p.localProfile,
            cloudSnapshot: p.cloudSnapshot,
          },
        });
      },

      closeMigratePrompt: () => {
        const cur = get().migratePrompt;
        if (!cur) return;
        set({ migratePrompt: { ...cur, open: false } });
      },

      /** 抓本机快照（必须在 applyRemote 之前调用 —— 红线③） */
      captureLocalNow: () => {
        const c = captureLocal();
        set({ capturedLocal: c });
        return c;
      },

      clearCapturedLocal: () => set({ capturedLocal: null }),

      reset: () => {
        // 登出：清 user/cachedAt，保留 cloudEnabled（NFR-01：降级结论要留住）
        set({
          status: 'guest',
          user: null,
          cachedAt: null,
          lastSyncedAt: null,
          pendingCount: 0,
          pendingDelta: null,
          syncStatus: get().cloudEnabled ? 'idle' : 'unavailable',
          migratePrompt: null,
          capturedLocal: null,
        });
      },

      /* ---------------- 异步 ---------------- */

      checkHealth: async () => {
        const res = await api.health();
        const enabled = res.ok && res.data.cloud === true;
        get().setHealth(enabled);
        return enabled;
      },

      register: (req) => doAuth(set, get, () => api.register(req)),

      login: (req) => doAuth(set, get, () => api.login(req)),

      refreshSession: () =>
        doAuth(set, get, () => api.me(), {
          /** me 失败不等于登出：只有明确的 401 才转游客（ARCH §5.3） */
          onUnauthorized: () => {
            syncEngine.stop();
            get().setGuest();
          },
          onTransientError: () => {
            // 网络/超时：保留缓存用户，标记离线，等下次自动重试
            const cached = get().user;
            if (!cached) {
              syncEngine.stop();
              get().setGuest();
              return;
            }
            set({ status: 'authenticated', syncStatus: 'offline' });
            syncEngine.start(cached.id);
          },
        }),

      logout: async () => {
        // 先停引擎（清 base 与监听），再发请求；请求失败也要走完本地清理
        syncEngine.stop();
        try {
          await api.logout();
        } catch {
          /* api 层本身不抛，这里只是双保险 */
        }
        get().reset();
      },

      updateProfile: async (req) => {
        const res = await api.updateProfile(req);
        if (!res.ok) return { ok: false, code: res.error.code, error: res.error.message };
        set({ user: res.data.user, cachedAt: Date.now() });
        return { ok: true };
      },

      manualSync: () => syncEngine.manualSync(),
    }),
    {
      name: LS_KEYS.AUTH_CACHE,
      version: 1,
      storage: createJSONStorage<PersistedAuth>(() => localStorage),
      partialize: (s) => ({ user: s.user, cachedAt: s.cachedAt, cloudEnabled: s.cloudEnabled }),
    },
  ),
);

/* ---------------- 认证流水线（顺序敏感，勿改） ---------------- */

type AuthSetter = (partial: Partial<AuthState>) => void;
type AuthGetter = () => AuthState;

interface DoAuthOptions {
  onUnauthorized?: () => void;
  onTransientError?: () => void;
}

/**
 * 注册 / 登录 / 会话恢复 共用的认证流水线。
 *
 * 顺序（红线③⑥，任一步调换都会静默丢数据或让迁移弹窗失效）：
 *   ① captureLocal    —— 抓本机快照，必须在 applyRemote 之前
 *   ② 判定 needsMigrate
 *   ③ setSuspended(true) —— 弹窗期间挂起防抖上报（否则 keep_cloud 选项直接失效）
 *   ④ applyRemote     —— 云端覆盖本地 + base 重置（内部 suppress，不回环）
 *   ⑤ start           —— 装载 base、注册写入监听
 *   ⑥ openMigratePrompt
 */
async function doAuth(
  set: AuthSetter,
  get: AuthGetter,
  call: () => Promise<ApiResponse<AuthSessionResponse>>,
  options: DoAuthOptions = {},
): Promise<AuthResult> {
  let res: ApiResponse<AuthSessionResponse>;
  try {
    res = await call();
  } catch {
    options.onTransientError?.();
    return { ok: false, code: 'NETWORK', error: api.errorTextOf('NETWORK') };
  }

  if (!res.ok) {
    if (res.error.code === 'UNAUTHORIZED') {
      options.onUnauthorized?.();
    } else if (res.error.code === 'CLOUD_DISABLED') {
      get().setHealth(false);
      syncEngine.stop();
      get().setGuest();
    } else if (
      res.error.code === 'NETWORK' ||
      res.error.code === 'TIMEOUT' ||
      res.error.code === 'INTERNAL'
    ) {
      options.onTransientError?.();
    }
    return { ok: false, code: res.error.code, error: res.error.message };
  }

  const data = res.data;

  // ① 抓本机快照（红线③：必须在 applyRemote 之前）
  const captured = get().captureLocalNow();

  // ② 是否需要迁移
  const needsMigrate = data.user.migratedAt === null && hasNonZeroProgress(captured.snapshot);

  // ③ 先挂起，再写本地（红线⑥）
  if (needsMigrate) syncEngine.setSuspended(true);

  // ④ 云端覆盖本地 + base 重置（内部 suppress）
  syncEngine.applyRemote(data.snapshot, data.revision);

  // ⑤ 启动引擎（装载 base、注册写入监听与生命周期钩子）
  syncEngine.start(data.user.id);

  set({
    status: 'authenticated',
    user: data.user,
    cachedAt: Date.now(),
    syncStatus: 'idle',
    lastSyncedAt: Date.now(),
    pendingCount: 0,
    pendingDelta: null,
  });

  // ⑥ 开迁移弹窗
  if (needsMigrate) {
    get().openMigratePrompt({
      email: data.user.email,
      localSnapshot: captured.snapshot,
      localProfile: captured.profile,
      cloudSnapshot: data.snapshot,
    });
  }

  return { ok: true, needsMigrate, alreadyMigrated: data.user.migratedAt !== null };
}

/* ---------------- 选择器（供 UI 直接用，减少重复判空） ---------------- */

export const selectIsAuthenticated = (s: AuthState): boolean => s.status === 'authenticated';
export const selectCloudUsable = (s: AuthState): boolean => s.cloudEnabled;
export const selectNeedsMigrate = (s: AuthState): boolean => s.migratePrompt?.open === true;
