import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../store/authStore';
import { useUserStore } from '../store/userStore';
import { LS_KEYS } from '../../shared/constants';

/**
 * 游客提示横幅（ARCH §5.3 / T04）
 *
 * 仅在「云端可用 + 当前为游客 + 已有本机账号」时显示，引导登录/注册云端账号。
 * 边界：隐藏于 /login、/register 自身页面；用户点「稍后再说」后本次会话不再出现
 * （sessionStorage: GUEST_SEEN，与迁移弹窗的 MIGRATE_DISMISSED 相互独立）。
 */
export default function GuestBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const cloudEnabled = useAuthStore((s) => s.cloudEnabled);
  const activeId = useUserStore((s) => s.activeId);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(LS_KEYS.GUEST_SEEN) === '1';
    } catch {
      return false;
    }
  });

  if (status !== 'guest' || !cloudEnabled || !activeId) return null;
  if (location.pathname === '/login' || location.pathname === '/register') return null;
  if (dismissed) return null;

  const dismiss = (): void => {
    try {
      sessionStorage.setItem(LS_KEYS.GUEST_SEEN, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pointer-events-none">
      <div className="max-w-2xl mx-auto pointer-events-auto flex items-center gap-3 bg-ink-card/95 backdrop-blur border border-gold-dark/30 rounded-2xl px-4 py-3 shadow-2xl animate-fade-up">
        <span className="text-xl">☁️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ivory font-medium">登录云端账号，进度多端同步</p>
          <p className="text-xs text-ivory/50 truncate">换手机、清缓存也不丢你的段位与战绩</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="shrink-0 bg-gold text-ink text-sm font-semibold rounded-xl px-4 py-2 active:scale-95"
        >
          去登录
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="稍后再说"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-ivory/40 hover:text-ivory hover:bg-ink-light active:scale-95"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
