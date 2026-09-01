// ============================================================
// src/lib/syncEngine.ts —— 增量同步引擎（ARCH §3.4 / §6 / T03.6 / T03.11 / T03.12）
//
// 核心模型：**delta = 当前本地值 − base**，base 持久化在 localStorage。
// 断网三天、中途刷新十次，delta 依然是这三天的全量增量，
// 因此不需要任何离线队列（ARCH §6.2 的关键设计）。
//
// 🔴 四条红线（写错会静默丢数据，改动前务必重读）：
//   ① 409 冲突 → **换基准、留增量**，绝不重算 delta
//   ② 回写本地必须 suppress，否则「写本地 → 触发上报 → 又写本地」死循环
//   ③ captureLocal 必须在 applyRemote 之前
//   ④ 「立即同步」= 先 push 再 pull，push 失败禁止 pull
//   ⑤ 迁移成功后先重置 base，再释放上报挂起
//   ⑥ 迁移弹窗打开期间必须挂起自动上报
// ============================================================
import {
  ACCUM_FIELDS,
  BACKOFF,
  EMPTY_CATEGORY,
  LS_KEYS,
  PEAK_FIELDS,
  SYNC_DEBOUNCE_MS,
} from '../../shared/constants';
import type {
  AccumField,
  ApiErrorCode,
  CategoryStat,
  MigrateStrategy,
  PeakField,
  ProgressSnapshot,
  SyncPushRequest,
} from '../types/cloud';
import { __onWrite as onDrillWrite } from '../store/drillStats';
import { __onWrite as onProfileWrite } from '../store/points';
import { useUserStore } from '../store/userStore';
import * as api from './api';
import { captureLocal, normalizeSnapshot, readLocalSnapshot, writeLocalSnapshot } from './localSnapshot';
import { useAuthStore } from '../store/authStore';

/* ---------------- 调试日志（仅 dev） ---------------- */
const DEBUG = import.meta.env?.DEV === true;
function log(...args: unknown[]): void {
  if (DEBUG) console.debug('[sync]', ...args);
}

/* ---------------- 模块内状态 ---------------- */

interface SyncState {
  started: boolean;
  userId: string | null;
  /** 上次成功同步时的云端值（base）。null = 尚无基准，禁止上报 */
  base: ProgressSnapshot | null;
  baseRevision: number;
  debouncer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  suspended: boolean;
  /** >0 表示正在回写本地，期间所有 markDirty 一律忽略（红线②） */
  suppressDepth: number;
}

const state: SyncState = {
  started: false,
  userId: null,
  base: null,
  baseRevision: 0,
  debouncer: null,
  inFlight: false,
  suspended: false,
  suppressDepth: 0,
};

/** 防抖时长（测试可注入，生产恒为 SYNC_DEBOUNCE_MS） */
let debounceMs = SYNC_DEBOUNCE_MS;

let unsubUser: (() => void) | null = null;
let lifecycleAttached = false;

interface BaseRecord {
  userId: string;
  base: ProgressSnapshot;
  revision: number;
}

/* ---------------- base 持久化 ---------------- */

function loadBase(): void {
  try {
    const raw = localStorage.getItem(LS_KEYS.SYNC_BASE);
    if (!raw) {
      state.base = null;
      state.baseRevision = 0;
      return;
    }
    const parsed = JSON.parse(raw) as Partial<BaseRecord> | null;
    if (parsed && parsed.userId === state.userId && parsed.base) {
      state.base = normalizeSnapshot(parsed.base);
      state.baseRevision = typeof parsed.revision === 'number' ? parsed.revision : 0;
      return;
    }
    clearBase(); // userId 不匹配 → 直接丢弃，绝不能拿别人的基准算 delta
  } catch {
    state.base = null;
    state.baseRevision = 0;
  }
}

function persistBase(): void {
  try {
    if (!state.userId || !state.base) {
      localStorage.removeItem(LS_KEYS.SYNC_BASE);
      return;
    }
    const rec: BaseRecord = {
      userId: state.userId,
      base: state.base,
      revision: state.baseRevision,
    };
    localStorage.setItem(LS_KEYS.SYNC_BASE, JSON.stringify(rec));
  } catch {
    /* localStorage 不可用（隐私模式）时静默降级：base 只在内存里 */
  }
}

function clearBase(): void {
  state.base = null;
  state.baseRevision = 0;
  try {
    localStorage.removeItem(LS_KEYS.SYNC_BASE);
  } catch {
    /* ignore */
  }
}

/* ---------------- 工具 ---------------- */

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 在 suppress 保护下执行回写本地（红线②） */
function suppress<T>(fn: () => T): T {
  state.suppressDepth += 1;
  try {
    return fn();
  } finally {
    state.suppressDepth -= 1;
  }
}

function clearDebounce(): void {
  if (state.debouncer !== null) {
    clearTimeout(state.debouncer);
    state.debouncer = null;
  }
}

function canSync(): boolean {
  if (!state.started) return false;
  if (state.suspended) return false;
  const s = useAuthStore.getState();
  return s.status === 'authenticated' && s.cloudEnabled;
}

/* ---------------- delta 计算 ---------------- */

/** 统计一次 payload 里有多少项变更（供 UI「N 条待同步」） */
export function countChanges(p: SyncPushRequest): number {
  return (
    Object.keys(p.delta ?? {}).length +
    Object.keys(p.peak ?? {}).length +
    Object.keys(p.perCategoryDelta ?? {}).length +
    (p.checkin ? 1 : 0) +
    (p.lww ? 1 : 0)
  );
}

/**
 * 计算 delta = 当前本地值 − base。
 * @returns null = 无变化（或尚无 base），无需上报
 */
export function computeDelta(): SyncPushRequest | null {
  const base = state.base;
  if (!base) return null;
  const cur = readLocalSnapshot();
  let changed = false;

  /* ① 增量累加型 ACCUM：delta = current − base */
  const delta: Partial<Record<AccumField, number>> = {};
  for (const f of ACCUM_FIELDS) {
    const d = cur[f] - base[f];
    if (d !== 0) {
      delta[f] = d;
      changed = true;
    }
  }

  /* ② 峰值型 PEAK：只在本地变大时提交绝对值，服务端执行 max */
  const peak: Partial<Record<PeakField, number>> = {};
  for (const f of PEAK_FIELDS) {
    if (cur[f] > base[f]) {
      peak[f] = cur[f];
      changed = true;
    }
  }

  /* ③ 分项正确数：逐 key 差值，只提交非 0 的 key */
  const perCategoryDelta: Record<string, Partial<CategoryStat>> = {};
  const keys = new Set<string>([
    ...Object.keys(cur.drillPerCategory ?? {}),
    ...Object.keys(base.drillPerCategory ?? {}),
  ]);
  for (const k of keys) {
    const c = cur.drillPerCategory?.[k] ?? EMPTY_CATEGORY;
    const b = base.drillPerCategory?.[k] ?? EMPTY_CATEGORY;
    const da = c.answered - b.answered;
    const dc = c.correct - b.correct;
    if (da !== 0 || dc !== 0) {
      const item: Partial<CategoryStat> = {};
      if (da !== 0) item.answered = da;
      if (dc !== 0) item.correct = dc;
      perCategoryDelta[k] = item;
      changed = true;
    }
  }

  /* ④ 签到型：只在有变化时提交（服务端对 last/days 取 max） */
  const checkin =
    cur.lastDailyCheckin !== base.lastDailyCheckin ||
    cur.consecutiveLoginDays !== base.consecutiveLoginDays
      ? {
          lastDailyCheckin: cur.lastDailyCheckin,
          consecutiveLoginDays: cur.consecutiveLoginDays,
        }
      : null;

  /* ⑤ LWW：drillStreak，只在本地确实改过时提交 */
  const lww =
    cur.drillStreak !== base.drillStreak
      ? { drillStreak: cur.drillStreak, clientUpdatedAt: Date.now() }
      : null;

  if (checkin) changed = true;
  if (lww) changed = true;
  if (!changed) return null;

  return {
    baseRevision: state.baseRevision,
    delta,
    peak,
    perCategoryDelta,
    checkin,
    lww,
  };
}

/**
 * 客户端侧复刻服务端 mergeProgress 的合并矩阵（ARCH §6.5）。
 * 只在 409 冲突时用于把「云端最新值 + 我的增量」写回本地，
 * clamp 规则必须与服务端逐条一致，否则两端会漂移。
 */
export function applyDeltaToSnapshot(
  cloud: ProgressSnapshot,
  p: SyncPushRequest,
): ProgressSnapshot {
  const out = normalizeSnapshot(cloud);

  for (const f of ACCUM_FIELDS) {
    const d = p.delta?.[f];
    if (typeof d === 'number' && Number.isFinite(d)) out[f] = out[f] + Math.trunc(d);
  }
  for (const f of PEAK_FIELDS) {
    const v = p.peak?.[f];
    if (typeof v === 'number' && Number.isFinite(v)) out[f] = Math.max(out[f], Math.trunc(v));
  }

  const cat: Record<string, CategoryStat> = { ...out.drillPerCategory };
  for (const [k, d] of Object.entries(p.perCategoryDelta ?? {})) {
    const c = cat[k] ?? EMPTY_CATEGORY;
    const a = Math.max(0, c.answered + (d.answered ?? 0));
    let r = Math.max(0, c.correct + (d.correct ?? 0));
    if (r > a) r = a;
    cat[k] = { answered: a, correct: r };
  }
  out.drillPerCategory = cat;

  if (p.checkin) {
    out.lastDailyCheckin = Math.max(out.lastDailyCheckin, p.checkin.lastDailyCheckin);
    out.consecutiveLoginDays = Math.max(
      out.consecutiveLoginDays,
      p.checkin.consecutiveLoginDays,
    );
  }
  if (p.lww) {
    out.drillStreak = Math.max(0, Math.trunc(p.lww.drillStreak));
  }

  /* 与服务端 mergeProgress 末尾完全一致的四条防御性 clamp */
  out.xp = Math.max(0, out.xp);
  out.points = Math.max(0, out.points);
  if (out.handsWon > out.handsPlayed) out.handsWon = out.handsPlayed;
  if (out.drillCorrect > out.drillAnswered) out.drillCorrect = out.drillAnswered;
  if (out.drillBestStreak < out.drillStreak) out.drillBestStreak = out.drillStreak;

  return out;
}

/* ---------------- 409 冲突：换基准、留增量（红线①） ---------------- */

/**
 * 收到 409 后的正确处理。
 *
 * 反例（会吞掉别人的增量）：base := 云端值 后重算 delta。
 *   A、B 同基于 rev5（云端 X）。A 先 push +10 → 云端 X+10 / rev6。
 *   B push +5 被拒，若 B 令 base = X+10 而 current = X+5 → 重算 delta = −5
 *   → 云端被减成 X+5，A 的 10 分人间蒸发。
 *
 * 正确做法：
 *   ① 我的 delta 基于**旧 base** 算出，与云端最新值无关 → 原样保留
 *   ② 本机新值 := 云端最新值 + 我的增量（写本地时 suppress）
 *   ③ 只换基准：base := 云端快照，baseRevision := 云端 revision
 *   ④ 下一轮 computeDelta() 得到同一个 delta，重发给新 revision
 */
export function applyConflict(c: { snapshot: ProgressSnapshot; revision: number }): void {
  // ① 基于旧 base 取我自己的增量（此刻 base 还没换）
  const myDelta = computeDelta();
  if (!myDelta) {
    // 并发 flush 已把增量清空：只换基准即可
    setBase(c.snapshot, c.revision);
    return;
  }
  // ② 云端最新 + 我的增量 = 本机应有值
  const merged = applyDeltaToSnapshot(c.snapshot, myDelta);
  // ③ 写回本地（suppress，避免回环 —— 红线②）
  suppress(() => writeLocalSnapshot(merged));
  // ④ 只换基准，增量原样保留（current 已被抬高，故 delta 不变）
  setBase(c.snapshot, c.revision);
}

/* ---------------- push ---------------- */

/**
 * 一次完整的增量上报（含 409 退避重试）。无锁，由 flush / manualSync 加锁。
 * @returns true = 已同步或无变化；false = 失败（增量留在 base 差值里等下次）
 */
async function pushOnce(): Promise<boolean> {
  if (!canSync()) return false;

  let payload = computeDelta();
  if (!payload) {
    useAuthStore.getState().markSynced(0);
    return true;
  }

  useAuthStore.getState().setSyncStatus('syncing');
  useAuthStore.getState().setPending(countChanges(payload), payload);

  for (let attempt = 0; attempt <= BACKOFF.CONFLICT.length; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF.CONFLICT[attempt - 1]);
    if (!payload) {
      useAuthStore.getState().markSynced(0);
      return true;
    }

    const res = await api.syncPush(payload);

    if (res.ok) {
      // base := 云端合并后的最新值 → delta 归零
      setBase(res.data.snapshot, res.data.revision);
      useAuthStore.getState().markSynced(0);
      return true;
    }

    const conflict = api.getConflictPayload(res);
    if (conflict) {
      log('409 → 换基准留增量', conflict.revision);
      applyConflict(conflict);
      // ★ 这里**必须**用 computeDelta() 重新取值，但它的结果一定等于冲突前的
      //   那个 delta（因为 applyConflict 已同步抬高了本地值），绝不可能是负数削弱。
      payload = computeDelta();
      continue;
    }

    if (res.error.code === 'CLOUD_DISABLED') {
      useAuthStore.getState().setHealth(false);
      useAuthStore.getState().setSyncStatus('unavailable');
      return false;
    }
    // 其它错误：静默降级，增量留在 base 差值中等下次（ARCH §10.2）
    useAuthStore.getState().setSyncStatus('offline');
    return false;
  }

  // 连续冲突重试仍失败
  useAuthStore.getState().setSyncStatus('offline');
  return false;
}

/* ---------------- 触发点 ---------------- */

function scheduleFlush(): void {
  clearDebounce();
  state.debouncer = setTimeout(() => {
    state.debouncer = null;
    void flush({ reason: 'debounce' });
  }, debounceMs);
}

/**
 * 本地三源任一发生写入时调用（由 points / drillStats 的 notifyWrite
 * 与 userStore 的订阅回调驱动）。廉价：只清/设定时器。
 */
export function markDirty(): void {
  if (!state.started) return;
  if (state.suppressDepth > 0) return; // 正在回写本地（红线②）
  if (state.suspended) return; // 迁移弹窗期间挂起（红线⑥）
  if (!canSync()) return; // 游客 / 云端不可用 → 零网络行为
  scheduleFlush();
}

/** 立即上报（清掉防抖并马上 flush）。挂起期间直接 return（T03.12） */
export async function flush(opts: { reason?: string } = {}): Promise<void> {
  if (!canSync()) return;
  clearDebounce();
  if (state.inFlight) return; // 并发保护：同一时刻只允许 1 个 push
  state.inFlight = true;
  try {
    log('flush', opts.reason ?? 'manual');
    await pushOnce();
  } catch {
    /* 同步失败绝不能影响玩法 */
  } finally {
    state.inFlight = false;
  }
}

/* ---------------- 生命周期 ---------------- */

function onVisibility(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'hidden') return;
  // 切后台：立即 flush（真实 fetch，能拿到响应更新 base）
  clearDebounce();
  void flush({ reason: 'hidden' });
}

/**
 * pagehide 兜底：visibilitychange→hidden 一定先于 pagehide 触发且已做过一次
 * 完整 flush，所以走到这里通常已经没有待同步增量（computeDelta 为 null 直接返回）。
 * 只有在「hidden 那次 flush 失败 / 没跑成」时才会真正发包。
 *
 * ⚠️ 已知边界：sendBeacon/keepalive 都是「发了就不管」，无法确认服务端是否收到，
 *    因此**不更新 base**。若请求实际送达而 base 未推进，下次冷启动会重发同一份
 *    delta（最多重复一次会话增量）。base 持久化保证不丢，只是可能虚增。
 *    P1 建议：push 增加 clientRequestId 做服务端幂等。
 */
async function flushOnPageHide(): Promise<void> {
  if (!canSync()) return;
  if (state.inFlight) return; // 已有请求在飞，不再发第二份（否则可能重复累加）
  const payload = computeDelta();
  if (!payload) return; // 已被 hidden 那次 flush 清空
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/sync/push', blob);
      return;
    }
    await fetch('/api/sync/push', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  } catch {
    /* ignore */
  }
}

function onPageHide(): void {
  void flushOnPageHide();
}

function attachLifecycle(enable: boolean): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (enable) {
    if (lifecycleAttached) return;
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    lifecycleAttached = true;
    return;
  }
  if (!lifecycleAttached) return;
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', onVisibility);
  lifecycleAttached = false;
}

/* ---------------- 启停 ---------------- */

export function start(userId: string): void {
  if (!userId) return;
  if (state.started && state.userId === userId) return; // 幂等
  if (state.started) stop(); // 换了用户 → 先彻底停掉

  state.userId = userId;
  loadBase();

  if (!unsubUser) {
    unsubUser = useUserStore.subscribe(() => {
      markDirty();
    });
  }
  onProfileWrite(markDirty);
  onDrillWrite(markDirty);
  attachLifecycle(true);

  state.started = true;
  log('started', userId, 'baseRev', state.baseRevision);
}

export function stop(): void {
  state.started = false;
  clearDebounce();
  unsubUser?.();
  unsubUser = null;
  onProfileWrite(null);
  onDrillWrite(null);
  attachLifecycle(false);
  state.userId = null;
  state.suspended = false; // 防止下次登录后一直挂起
  clearBase();
  log('stopped');
}

/**
 * 迁移弹窗期间挂起自动上报（红线⑥ / T03.12）。
 * · 幂等；可在 start() 之前调用（此时只置标志、不发请求）
 * · 挂起期间 flush() 直接 return、防抖定时器清零
 * · 释放后补发 1 次，且不会重复累加（delta 由 base 差值定义，天然幂等）
 */
export function setSuspended(v: boolean): void {
  if (state.suspended === v) return;
  state.suspended = v;
  if (v) {
    clearDebounce();
    return;
  }
  if (!state.started) return;
  if (!canSync()) return;
  log('resume → 补发一次');
  void flush({ reason: 'resume' });
}

export function isSuspended(): boolean {
  return state.suspended;
}

export function isStarted(): boolean {
  return state.started;
}

/* ---------------- 远端快照落地 ---------------- */

/** 仅更新 base，不动本地数据（「稍后再说」的 rebase 依赖它） */
export function setBase(snapshot: ProgressSnapshot, revision: number): void {
  state.base = normalizeSnapshot(snapshot);
  if (typeof revision === 'number' && Number.isFinite(revision)) {
    state.baseRevision = revision;
  }
  persistBase();
}

export function getBase(): ProgressSnapshot | null {
  return state.base;
}

export function getBaseRevision(): number {
  return state.baseRevision;
}

/**
 * 云端快照覆盖本地三源，并把 base 置为该快照（delta 归零）。
 * 内部已用 suppress 包裹，不会触发上报（红线②）。
 */
export function applyRemote(snapshot: ProgressSnapshot, revision: number): void {
  const snap = normalizeSnapshot(snapshot);
  suppress(() => writeLocalSnapshot(snap));
  setBase(snap, revision);
  useAuthStore.getState().markSynced(0);
  log('applyRemote → base 重置', revision);
}

/* ---------------- 立即同步（先 push 再 pull） ---------------- */

/**
 * 「立即同步」按钮（红线④ / PM Q4 失败矩阵）。
 * · 先 push 把本地增量推上去；**push 失败禁止 pull**（直接 pull 会丢本地增量）
 * · push 成功但 pull 失败 → 转 uploaded（云端已收到，本地待刷新）
 */
export async function manualSync(): Promise<{ ok: boolean; error?: string }> {
  const s = useAuthStore.getState();
  if (s.status !== 'authenticated') return { ok: false, error: '尚未登录' };
  if (!s.cloudEnabled) return { ok: false, error: '云端账号暂未开放' };
  if (!state.started) return { ok: false, error: '同步引擎未启动' };

  clearDebounce();
  if (state.inFlight) return { ok: false, error: '同步进行中，请稍后再试' };
  state.inFlight = true;
  try {
    const pushed = await pushOnce();
    if (!pushed) {
      useAuthStore.getState().setSyncStatus('offline');
      return { ok: false, error: '网络不可用，已保留本地进度' };
    }
    const pulled = await api.syncPull();
    if (!pulled.ok) {
      useAuthStore.getState().setSyncStatus('uploaded');
      return { ok: false, error: '已上传，将在下次自动刷新' };
    }
    applyRemote(pulled.data.snapshot, pulled.data.revision);
    useAuthStore.getState().setSyncStatus('idle');
    useAuthStore.getState().markSynced(0);
    return { ok: true };
  } finally {
    state.inFlight = false;
  }
}

/* ---------------- 迁移 ---------------- */

export interface RunMigrateOptions {
  strategy: MigrateStrategy;
  /** 昵称/头像，缺省取迁移弹窗打开瞬间冻结的本机值 */
  profile?: { nickname: string; avatar: string };
  /** ARCH T02.6：一旦传入即覆盖 merge 策略里的昵称/头像 LWW 判定 */
  profileOverride?: 'keep_cloud' | 'use_local';
  /** merge 必须用**冻结快照**；overwrite 用执行时的实时快照（ARCH §6.9 配套规则） */
  frozenSnapshot?: ProgressSnapshot | null;
}

export interface MigrateResult {
  ok: boolean;
  code?: ApiErrorCode;
  error?: string;
  alreadyMigrated?: boolean;
}

/**
 * 执行迁移。成功后**先 applyRemote（内含 base 重置）再返回**，
 * 调用方随后再 setSuspended(false)（红线⑤：顺序反了残留 delta 会翻倍上报）。
 */
export async function runMigrate(options: RunMigrateOptions): Promise<MigrateResult> {
  const s = useAuthStore.getState();
  if (s.status !== 'authenticated') return { ok: false, error: '尚未登录' };
  if (!s.cloudEnabled) return { ok: false, error: '云端账号暂未开放' };

  const live = captureLocal();
  const snapshot =
    options.strategy === 'overwrite'
      ? live.snapshot
      : options.frozenSnapshot ?? s.capturedLocal?.snapshot ?? live.snapshot;
  const profile = options.profile ?? s.capturedLocal?.profile ?? live.profile;

  const req: api.MigrateRequestWithOverride = {
    strategy: options.strategy,
    snapshot,
    profile,
    clientUpdatedAt: Date.now(),
  };
  if (options.profileOverride) req.profileOverride = options.profileOverride;

  let res;
  try {
    res = await api.migrate(req);
  } catch {
    return { ok: false, code: 'NETWORK', error: api.errorTextOf('NETWORK') };
  }
  if (!res.ok) return { ok: false, code: res.error.code, error: res.error.message };

  // ★ base 重置必须发生在释放挂起之前（红线⑤）
  applyRemote(res.data.snapshot, res.data.revision);
  useAuthStore.getState().setAuthenticated(res.data.user);
  useAuthStore.getState().clearCapturedLocal();
  return { ok: true, alreadyMigrated: res.data.alreadyMigrated };
}

/**
 * 「稍后再说」/ ✕ / 遮罩点击 的统一出口（ARCH §6.9）。
 * 必须 rebase：把 base 抬到当前本地快照，历史差额被冻结出队，
 * 否则「稍后再说」等于替用户做了 merge，keep_cloud 选项会失效。
 */
export function dismissMigrate(): void {
  setBase(readLocalSnapshot(), state.baseRevision);
  useAuthStore.getState().closeMigratePrompt();
  setSuspended(false);
}

/* ---------------- 查询 ---------------- */

export function hasPending(): boolean {
  return computeDelta() !== null;
}

export function pendingCount(): number {
  const p = computeDelta();
  return p === null ? 0 : countChanges(p);
}

/** 测试专用的防抖时长注入口（生产不要调用） */
export function setDebounceMs(ms: number): void {
  debounceMs = ms;
}

/* ---------------- 对外统一出口 ---------------- */

export const syncEngine = {
  start,
  stop,
  setSuspended,
  isSuspended,
  isStarted,
  markDirty,
  flush,
  manualSync,
  applyRemote,
  setBase,
  getBase,
  getBaseRevision,
  computeDelta,
  countChanges,
  hasPending,
  pendingCount,
  runMigrate,
  dismissMigrate,
  setDebounceMs,
} as const;
