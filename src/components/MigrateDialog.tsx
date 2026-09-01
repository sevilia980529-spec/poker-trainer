import { useState } from 'react';
import Modal from './common/Modal';
import Button from './common/Button';
import { useAuthStore } from '../store/authStore';
import { syncEngine } from '../lib/syncEngine';
import type { MigrateStrategy, ProgressSnapshot } from '../types/cloud';

/**
 * 游客进度迁移弹窗（ARCH §6.9 / T05）
 *
 * 触发：doAuth 发现「云端账号此前未迁移过(migratedAt=null) 且本机有非零进度」。
 * 三策略（与服务端 computeMigrate 一一对应）：
 *   · merge（默认推荐）：本机进度增量合并到云端
 *   · overwrite：用本机整份覆盖云端
 *   · keep_cloud：用云端覆盖本机（丢弃本机进度）
 * 「稍后再说」走 dismissMigrate：rebase（base 抬到当前本地）后关闭，不弹第二次。
 *
 * 红线：runMigrate 内部已完成「applyRemote（含 base 重置）→ 释放挂起」，
 * 本组件在成功后只需 closeMigratePrompt；稍后再说走 dismissMigrate 一并处理。
 */
function summarize(s: ProgressSnapshot): string {
  return `段位 ${s.xp} XP · 欢乐豆 ${s.points.toLocaleString()} · 场次 ${s.handsPlayed} · 答题 ${s.drillAnswered}`;
}

export default function MigrateDialog() {
  const prompt = useAuthStore((s) => s.migratePrompt);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!prompt || !prompt.open) return null;

  const choose = async (strategy: MigrateStrategy): Promise<void> => {
    setError(null);
    setProcessing(true);
    const res = await syncEngine.runMigrate({ strategy });
    setProcessing(false);
    if (!res.ok) {
      setError(res.error ?? '迁移失败，请重试');
      return;
    }
    // runMigrate 已 applyRemote（base 重置），此处只需关闭弹窗（挂起已在内部释放）
    useAuthStore.getState().closeMigratePrompt();
  };

  const later = (): void => {
    syncEngine.dismissMigrate();
  };

  return (
    <Modal open title="发现本机进度" dismissible={false} onClose={() => {}}>
      <p className="text-sm text-ivory/70 mb-4">
        账号 <span className="text-gold">{prompt.email}</span> 还没有进度数据。
        是否把本机训练进度同步到云端？
      </p>

      <div className="space-y-2 text-xs text-ivory/60 mb-4">
        <div className="bg-ink-light/50 rounded-xl p-3">
          <div className="text-ivory/50 mb-1">本机进度</div>
          <div className="text-ivory/90">{summarize(prompt.localSnapshot)}</div>
        </div>
        <div className="bg-ink-light/50 rounded-xl p-3">
          <div className="text-ivory/50 mb-1">云端进度</div>
          <div className="text-ivory/90">{summarize(prompt.cloudSnapshot)}</div>
        </div>
      </div>

      <div className="space-y-2">
        <Button
          fullWidth
          variant="primary"
          loading={processing}
          onClick={() => choose('merge')}
        >
          合并两份进度（推荐）
        </Button>
        <Button
          fullWidth
          variant="secondary"
          disabled={processing}
          onClick={() => choose('overwrite')}
        >
          用本机进度覆盖云端
        </Button>
        <Button
          fullWidth
          variant="secondary"
          disabled={processing}
          onClick={() => choose('keep_cloud')}
        >
          用云端进度覆盖本机
        </Button>
      </div>

      {error && <p className="text-xs text-danger mt-3 text-center">{error}</p>}

      <button
        type="button"
        onClick={later}
        disabled={processing}
        className="w-full text-center text-xs text-ivory/40 mt-4 active:scale-95 disabled:opacity-50"
      >
        稍后再说
      </button>
    </Modal>
  );
}
