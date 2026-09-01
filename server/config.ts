// ============================================================
// server/config.ts —— 环境变量读取
//
// ⚠️ 铁律（ARCH 附录 B-4）：必须用 **getter** 读 process.env，
//    不能在模块顶层固化常量。原因：Vite dev 的 dev-api-plugin 在
//    configureServer 里才把 .env 的值赋给 process.env，
//    若模块顶层固化，本地开发将永远读到 cloud:false。
// ============================================================
import crypto from 'node:crypto';

export interface ServerConfig {
  /** 云端是否可用：= !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) */
  CLOUD_ENABLED: boolean;
  SUPABASE_URL: string;
  SERVICE_ROLE_KEY: string;
  /** 会话令牌签名密钥。生产环境缺失时随机生成（重启后全部会话失效，但进程不崩） */
  SESSION_SECRET: string;
  IS_PROD: boolean;
  PORT: number;
}

/** 缺失 SESSION_SECRET 时的进程内兜底密钥（只活在当前进程，重启即换） */
let ephemeralSecret: string | null = null;

/**
 * 读取当前配置（每次调用都重新读 process.env）。
 */
export function getConfig(): ServerConfig {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const isProd = (process.env.NODE_ENV ?? '').trim() === 'production';

  let secret = (process.env.SESSION_SECRET ?? '').trim();
  if (!secret) {
    if (ephemeralSecret === null) {
      ephemeralSecret = crypto.randomBytes(32).toString('hex');
      console.warn(
        '[config] 未设置 SESSION_SECRET，已生成临时随机密钥；'
        + '生产环境务必在 Render 面板配置，否则重启后所有登录态失效。',
      );
    }
    secret = ephemeralSecret;
  }

  return {
    CLOUD_ENABLED: Boolean(supabaseUrl && serviceRoleKey),
    SUPABASE_URL: supabaseUrl,
    SERVICE_ROLE_KEY: serviceRoleKey,
    SESSION_SECRET: secret,
    IS_PROD: isProd,
    PORT: Number(process.env.PORT ?? 7100) || 7100,
  };
}

/** 云端是否可用（便捷读取） */
export function isCloudEnabled(): boolean {
  return getConfig().CLOUD_ENABLED;
}
