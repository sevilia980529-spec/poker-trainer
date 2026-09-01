import Button from './common/Button';
import { useToast } from './common/Toast';
import { useAuthStore } from '../store/authStore';
import type { SyncStatus } from '../store/authStore';

/**
 * 云端同步状态卡（ARCH §5.3 / T05）
 *
 * 仅在已登录（status === 'authenticated'）时由 Profile 渲染。
 * 展示：云端账号（邮箱 / 昵称）、同步态、待同步条数、立即同步按钮、退出云端账号。
 */
const STATUS_TEXT: Record<SyncStatus, string> = {
  idle: '已同步',
  syncing: '同步中…',
  uploaded: '已上传，待刷新',
  offline: '离线（已保留本地进度）',
  unavailable: '云端不可用',
};

const STATUS_COLOR: Record<SyncStatus, string> = {
  idle: 'text-success',
  syncing: 'text-gold',
  uploaded: 'text-gold',
  offline: 'text-ivory/50',
  unavailable: 'text-danger',
};

export default function CloudSyncCard() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const syncStatus = useAuthStore((s) => s.syncStatus);
  const pendingCount = useAuthStore((s) => s.pendingCount);
  const manualSync = useAuthStore((s) => s.manualSync);
  const logout = useAuthStore((s) => s.logout);
  const toast = useToast();

  if (status !== 'authenticated' || !user) return null;

  const onSync = async (): Promise<void> => {
    const res = await manualSync();
    if (!res.ok && res.error) toast.error(res.error);
    else toast.success('已同步到云端');
  };

  const onLogout = async (): Promise<void> => {
    await logout();
    toast.info('已退出云端账号（本机进度保留）');
  };

  return (
    <section className="glass rounded-2xl p-5 animate-fade-up">
      <h3 className="text-sm font-semibold text-ivory/80 mb-3">云端账号</h3>
      <div className="flex items-center gap-3 bg-ink-light/50 rounded-xl p-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-ink font-bold">
          {user.email.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ivory font-medium truncate">{user.nickname}</div>
          <div className="text-xs text-ivory/40 truncate">{user.email}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 text-xs">
        <span className="text-ivory/50">同步状态</span>
        <span className={STATUS_COLOR[syncStatus]}>
          {STATUS_TEXT[syncStatus]}
          {pendingCount > 0 && syncStatus !== 'syncing' ? ` · ${pendingCount} 条待同步` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button fullWidth variant="secondary" onClick={onSync}>
          立即同步
        </Button>
        <Button fullWidth variant="danger" onClick={onLogout}>
          退出云端账号
        </Button>
      </div>
    </section>
  );
}
