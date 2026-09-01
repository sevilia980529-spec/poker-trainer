import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

/**
 * 云端账号启动引导（ARCH §5.3 / T03.2）
 *
 * 应用挂载时执行一次：
 *   ① checkHealth() 探测云端是否可用（/api/health）
 *   ② 云端可用时，尝试用 httpOnly cookie 恢复会话（refreshSession）：
 *      - /api/auth/me 成功 → 自动登录（applyRemote + 启动同步引擎）
 *      - 401 → 游客
 *      - 网络/超时 → 保留缓存用户并标记离线，下次自动重试
 *
 * 优雅降级（NFR-01）：任意失败都不阻塞首屏；云端不可用时直接游客模式。
 * 仅运行一次（空依赖数组）。
 */
export function useCloudBootstrap(): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      const enabled = await useAuthStore.getState().checkHealth();
      if (!alive) return;
      if (!enabled) {
        // 云端未配置：无会话可恢复，直接游客
        if (useAuthStore.getState().status === 'unknown') {
          useAuthStore.getState().setGuest();
        }
        return;
      }
      // 云端可用：尝试用 cookie 恢复会话（无论本地是否已有缓存用户）
      await useAuthStore.getState().refreshSession();
    })();
    return () => {
      alive = false;
    };
  }, []);
}
