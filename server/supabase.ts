// ============================================================
// server/supabase.ts —— Supabase PostgREST 客户端（ARCH §7.5）
//
// 选型说明：用**原生 fetch** 直接调 PostgREST，不引入 @supabase/supabase-js。
//   ① 零新增依赖；② esbuild `--platform=node --format=esm` 打包无坑；
//   ③ 我们只需要 select / insert / patch 三个动作。
//
// ⚠️ service_role 只在本文件被读取，绝不外泄到任何响应体或前端产物。
// ⚠️ 绝不用模块顶层固化 REST 地址：环境变量可能晚于模块求值才被赋值。
// ============================================================
import { getConfig } from './config';
import { HttpError, httpError } from './errors';

/** PostgREST 基址（每次调用时重新拼，保证读到最新环境变量） */
function restUrl(): string {
  return `${getConfig().SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const { SERVICE_ROLE_KEY } = getConfig();
  if (!SERVICE_ROLE_KEY) throw httpError('CLOUD_DISABLED', '云端服务未配置');
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

interface CallOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** 统一发起 PostgREST 调用，做超时、错误归一与异常兜底 */
async function call(path: string, init: CallOptions = {}): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${restUrl()}/${path}`, {
      method: init.method ?? 'GET',
      headers: headers(init.headers),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ac.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      // 邮箱唯一索引冲突（大小写不敏感索引 users_email_lower_uidx）
      if (res.status === 409 && /23505|duplicate key|users_email_lower_uidx/i.test(txt)) {
        throw httpError('EMAIL_TAKEN', '该邮箱已被注册');
      }
      // ⚠️ 只记日志，绝不把 Supabase 的原始报错回传客户端（可能含表名/约束名）
      console.error('[supabase]', res.status, txt.slice(0, 300));
      throw httpError('INTERNAL', '数据库操作失败');
    }

    const txt = await res.text();
    if (!txt) return null;
    return JSON.parse(txt) as unknown;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error)?.name === 'AbortError') throw httpError('TIMEOUT', '数据库请求超时');
    throw httpError('NETWORK', '无法连接数据库');
  } finally {
    clearTimeout(timer);
  }
}

function toQuery(q: Record<string, string> | string): string {
  if (typeof q === 'string') return q;
  return Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/** 查询：返回行数组（无命中时为空数组） */
export function sbGet<T>(table: string, query: Record<string, string> | string): Promise<T[]> {
  return call(`${table}?${toQuery(query)}`) as Promise<T[]>;
}

/** 插入：默认 return=representation，返回插入后的行数组 */
export function sbInsert<T>(
  table: string,
  body: unknown,
  prefer = 'return=representation',
): Promise<T[]> {
  return call(table, {
    method: 'POST',
    headers: { Prefer: prefer },
    body,
  }) as Promise<T[]>;
}

/**
 * 条件更新（乐观锁 CAS，ARCH §1.1）：
 * `PATCH /rest/v1/<table>?<filters>` + `Prefer: return=representation`
 * 返回空数组 = 条件未命中（并发下已被别人改过）。
 * Postgres 在 READ COMMITTED 下 UPDATE...WHERE 会重新求值 WHERE，
 * 因此天然原子，无需事务或 SQL RPC。
 */
export function sbPatch<T>(
  table: string,
  filters: Record<string, string> | string,
  body: Record<string, unknown>,
): Promise<T[]> {
  return call(`${table}?${toQuery(filters)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body,
  }) as Promise<T[]>;
}
