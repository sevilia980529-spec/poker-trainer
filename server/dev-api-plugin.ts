// ============================================================
// server/dev-api-plugin.ts —— Vite dev 中间件（ARCH §7.7）
//
// 为什么必须加：vite.config.ts 原先只挂了 /ws（好友房），
// 没有任何 /api 路由或代理，本地联调全部 404。
// 这里把 handleApi 挂到 Vite dev server 同一端口：
//   · 与前端同源 → 不需要 CORS，也不需要 vite proxy
//   · 与好友房 WS 共用一个端口（3000）
//
// ⚠️ 安全：loadEnv 只把变量塞进 **服务端** 的 process.env，
//    Vite 只向客户端注入 VITE_ 前缀的变量，service_role 绝不会进 bundle。
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { handleApi } from './api';

export function apiPlugin(): Plugin {
  return {
    name: 'poker-trainer-api',
    configureServer(server) {
      // 让 server/config.ts 能读到根目录 .env 的变量（不依赖 --env-file）
      // 空前缀 = 载入全部变量（含 SUPABASE_* / SESSION_SECRET）
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) {
        if (!(k in process.env)) process.env[k] = v;
      }

      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleApi(
            req as IncomingMessage,
            res as ServerResponse,
          );
          if (!handled) next();
        } catch (e) {
          next(e);
        }
      });

      const cloud = Boolean(
        process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
      );
      console.log(
        `[api] /api/* 已挂载到 Vite dev server（云端账号：${cloud ? '已启用' : '未配置 → 游客模式'}）`,
      );
    },
  };
}
