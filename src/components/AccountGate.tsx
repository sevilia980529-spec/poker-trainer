import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import AccountForm from '../components/AccountForm';
import Avatar from './Avatar';

// 首启动 / 退出登录后的账号门：已存在账号则选择进入，否则创建新账号
export default function AccountGate() {
  const accounts = useUserStore((s) => s.accounts);
  const createAccount = useUserStore((s) => s.createAccount);
  const switchAccount = useUserStore((s) => s.switchAccount);
  const [mode, setMode] = useState<'list' | 'create'>(accounts.length > 0 ? 'list' : 'create');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink px-6 py-10">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-4xl shadow-xl mb-4">
        🃏
      </div>
      <h1 className="text-2xl font-bold text-ivory">扑克训练场</h1>
      <p className="text-sm text-ivory/50 mt-1 mb-6">创建你的牌手账号，开始训练</p>

      <div className="w-full max-w-sm glass rounded-2xl p-5">
        {mode === 'create' ? (
          <AccountForm submitLabel="进入训练场" onSubmit={(n, a) => createAccount(n, a)} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ivory/70">选择一个账号</p>
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => switchAccount(acc.id)}
                className="w-full flex items-center gap-3 bg-ink-light rounded-xl p-3 active:scale-95 transition-transform"
              >
                <Avatar value={acc.avatar} size={40} />
                <span className="text-ivory font-medium flex-1 text-left truncate">{acc.nickname}</span>
                <span className="text-xs text-ivory/40">进入 ›</span>
              </button>
            ))}
            <button
              onClick={() => setMode('create')}
              className="w-full text-center text-sm text-gold border border-gold/30 rounded-xl py-2.5 active:scale-95"
            >
              ＋ 新建账号
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-ivory/30 mt-6">账号数据保存在本机浏览器</p>
    </div>
  );
}
