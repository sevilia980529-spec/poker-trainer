import { useState } from 'react';
import { useNavigate } from 'react-router';
import PageHeader from '../components/common/PageHeader';
import LevelBadge from '../components/common/LevelBadge';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import Avatar from '../components/Avatar';
import AccountForm from '../components/AccountForm';
import CloudSyncCard from '../components/CloudSyncCard';
import { ToastContainer, useToast } from '../components/common/Toast';
import { useUserStore, useLevel } from '../store/userStore';
import { useAuthStore } from '../store/authStore';
import { loadProfile, saveProfile, defaultProfile, claimRelief, DAILY_BONUS, BUY_IN } from '../store/points';
import { loadDrillStats } from '../store/drillStats';
import Icon from '../components/Icon';

export default function Profile() {
  const nickname = useUserStore((s) => s.nickname);
  const avatar = useUserStore((s) => s.avatar);
  const xp = useUserStore((s) => s.xp);
  const consecutive = useUserStore((s) => s.consecutiveLoginDays);
  const accounts = useUserStore((s) => s.accounts);
  const activeId = useUserStore((s) => s.activeId);
  const updateAccount = useUserStore((s) => s.updateAccount);
  const createAccount = useUserStore((s) => s.createAccount);
  const switchAccount = useUserStore((s) => s.switchAccount);
  const deleteAccount = useUserStore((s) => s.deleteAccount);
  const logout = useUserStore((s) => s.logout);
  const { level, nextLevel, progress, xpToNext } = useLevel();
  const toast = useToast();
  const navigate = useNavigate();
  const cloudStatus = useAuthStore((s) => s.status);

  const [profile, setProfile] = useState(loadProfile);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(nickname);
  const [showEdit, setShowEdit] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const drillStats = loadDrillStats();

  const winRate = profile.handsPlayed > 0
    ? Math.round((profile.handsWon / profile.handsPlayed) * 100)
    : 0;
  const accuracy = profile.excellentActions + profile.mistakes > 0
    ? Math.round((profile.excellentActions / (profile.excellentActions + profile.mistakes)) * 100)
    : null;
  const drillAcc = drillStats.answered > 0
    ? Math.round((drillStats.correct / drillStats.answered) * 100)
    : null;

  const saveName = () => {
    updateAccount(activeId!, { nickname: nameInput });
    setEditingName(false);
    toast.success('昵称已更新');
  };

  const relief = () => {
    const next = claimRelief(loadProfile());
    saveProfile(next);
    setProfile(next);
    toast.success(`领取补给 +${DAILY_BONUS} 欢乐豆`);
  };

  const resetAll = () => {
    const fresh = defaultProfile();
    saveProfile(fresh);
    setProfile(fresh);
    setConfirmReset(false);
    toast.info('战绩已重置（段位 XP 保留）');
  };

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      <PageHeader title="个人中心" backTo="/" />
      <ToastContainer />

      <main className="flex-1 px-4 py-6 pb-8 max-w-2xl mx-auto w-full space-y-5">
        {/* 头像 + 昵称 + 段位 */}
        <section className="glass rounded-2xl p-5 animate-fade-up">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowEdit(true)}
              className="w-16 h-16 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center shadow-md overflow-hidden active:scale-95 transition-transform"
            >
              <Avatar value={avatar} size={64} />
            </button>
            <div className="flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={12}
                    className="bg-ink-light border border-gold-dark/40 rounded-lg px-2 py-1 text-ivory text-sm w-28 outline-none focus:border-gold"
                    autoFocus
                  />
                  <Button size="sm" onClick={saveName}>保存</Button>
                </div>
              ) : (
                <button onClick={() => { setNameInput(nickname); setEditingName(true); }}
                  className="text-lg font-bold text-ivory active:scale-95">
                  {nickname} <Icon e="✏️" size={14} className="align-middle" />
                </button>
              )}
              <div className="mt-1.5"><LevelBadge level={level} size="md" /></div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ivory/60">欢乐豆</div>
              <div className="text-xl font-bold text-gold num">{profile.points.toLocaleString()}</div>
            </div>
          </div>

          {nextLevel && (
            <div className="space-y-1.5 mt-4">
              <div className="flex justify-between text-xs text-ivory/60">
                <span>距离 {nextLevel.name}</span>
                <span>{xp.toLocaleString()} / {nextLevel.minXP.toLocaleString()} XP</span>
              </div>
              <div className="h-2 bg-ink-light rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-700"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <div className="text-xs text-ivory/40">再获得 {xpToNext} XP 升级</div>
            </div>
          )}
        </section>

        {/* 战绩 */}
        <section className="glass rounded-2xl p-5 animate-fade-up" style={{ animationDelay: '0.05s' }}>
          <h3 className="text-sm font-semibold text-ivory/80 mb-3">牌桌战绩</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { v: profile.handsPlayed, l: '总场次', c: 'text-ivory' },
              { v: `${winRate}%`, l: '胜率', c: 'text-success' },
              { v: `${profile.totalProfit >= 0 ? '+' : ''}${profile.totalProfit.toLocaleString()}`, l: '总盈亏', c: profile.totalProfit >= 0 ? 'text-success' : 'text-danger' },
              { v: profile.biggestPot.toLocaleString(), l: '最大底池', c: 'text-gold' },
              { v: accuracy !== null ? `${accuracy}%` : '—', l: '决策准确率', c: 'text-info' },
              { v: consecutive, l: '连续登录', c: 'text-ivory' },
            ].map((it) => (
              <div key={it.l} className="text-center bg-ink-light/50 rounded-xl py-3">
                <div className={`text-lg font-bold num ${it.c}`}>{it.v}</div>
                <div className="text-xs text-ivory/60 mt-0.5">{it.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 训练数据 */}
        <section className="glass rounded-2xl p-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <h3 className="text-sm font-semibold text-ivory/80 mb-3">训练数据</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { v: drillStats.answered, l: '已答题数', c: 'text-ivory' },
              { v: drillAcc !== null ? `${drillAcc}%` : '—', l: '答题正确率', c: 'text-success' },
              { v: drillStats.bestStreak, l: '最佳连对', c: 'text-gold' },
            ].map((it) => (
              <div key={it.l} className="text-center bg-ink-light/50 rounded-xl py-3">
                <div className={`text-lg font-bold num ${it.c}`}>{it.v}</div>
                <div className="text-xs text-ivory/60 mt-0.5">{it.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 云端账号 / 同步 */}
        {cloudStatus === 'authenticated' ? (
          <CloudSyncCard />
        ) : (
          <section className="glass rounded-2xl p-5 animate-fade-up" style={{ animationDelay: '0.11s' }}>
            <h3 className="text-sm font-semibold text-ivory/80 mb-2">云端同步</h3>
            <p className="text-xs text-ivory/60 mb-3">
              登录云端账号，进度自动同步到云端，换手机、清缓存也不丢。
            </p>
            <Button fullWidth variant="primary" onClick={() => navigate('/login')}>
              登录 / 注册云端账号
            </Button>
          </section>
        )}

        {/* 账号管理 */}
        <section className="glass rounded-2xl p-5 animate-fade-up" style={{ animationDelay: '0.12s' }}>
          <h3 className="text-sm font-semibold text-ivory/80 mb-3">账号</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3 bg-ink-light/50 rounded-xl p-3">
              <Avatar value={avatar} size={36} />
              <div className="flex-1">
                <div className="text-sm text-ivory font-medium">{nickname}</div>
                <div className="text-xs text-ivory/40">当前账号 · 共 {accounts.length} 个</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button fullWidth variant="ghost" onClick={() => setShowSwitch(true)}>切换账号</Button>
              <Button fullWidth variant="ghost" onClick={() => setShowAdd(true)}>添加账号</Button>
              <Button fullWidth variant="ghost" onClick={() => setConfirmLogout(true)}>退出登录</Button>
              <Button fullWidth variant="danger" onClick={() => setConfirmDelete(true)}>删除本账号</Button>
            </div>
          </div>
        </section>

        {/* 操作 */}
        <section className="space-y-3 animate-fade-up" style={{ animationDelay: '0.15s' }}>
          {profile.points < BUY_IN && (
            <Button fullWidth variant="primary" onClick={relief}>
              <Icon e="💰" size={16} className="align-middle" /> 欢乐豆不足，领取补给 +{DAILY_BONUS.toLocaleString()}
            </Button>
          )}
          <Button fullWidth variant="ghost" onClick={() => setConfirmReset(true)}>
            重置战绩数据
          </Button>
        </section>

        <div className="text-center text-xs text-ivory/30 pt-2">
          账号数据保存在本机浏览器 · 清缓存会丢失
        </div>
      </main>

      {/* 编辑资料（昵称 + 头像上传） */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="编辑资料">
        <AccountForm
          submitLabel="保存"
          initialNickname={nickname}
          initialAvatar={avatar}
          onSubmit={(n, a) => {
            updateAccount(activeId!, { nickname: n, avatar: a });
            setShowEdit(false);
            toast.success('资料已更新');
          }}
        />
      </Modal>

      {/* 切换账号 */}
      <Modal open={showSwitch} onClose={() => setShowSwitch(false)} title="切换账号">
        <div className="space-y-2">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => { switchAccount(acc.id); setShowSwitch(false); }}
              className={`w-full flex items-center gap-3 bg-ink-light rounded-xl p-3 active:scale-95 transition-transform ${
                acc.id === activeId ? 'ring-2 ring-gold' : ''
              }`}
            >
              <Avatar value={acc.avatar} size={36} />
              <span className="text-ivory font-medium flex-1 text-left truncate">{acc.nickname}</span>
              {acc.id === activeId && <span className="text-xs text-gold">当前</span>}
            </button>
          ))}
        </div>
      </Modal>

      {/* 添加账号 */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="添加账号">
        <AccountForm
          submitLabel="创建并切换"
          onSubmit={(n, a) => { createAccount(n, a); setShowAdd(false); toast.success('已创建账号'); }}
        />
      </Modal>

      {/* 退出登录确认 */}
      <Modal open={confirmLogout} onClose={() => setConfirmLogout(false)} title="退出登录？">
        <p className="text-sm text-ivory/80 mb-4">退出后将返回账号选择页，本机账号数据不会删除。</p>
        <div className="flex gap-3">
          <Button fullWidth variant="ghost" onClick={() => setConfirmLogout(false)}>取消</Button>
          <Button fullWidth variant="danger" onClick={() => { logout(); setConfirmLogout(false); }}>退出</Button>
        </div>
      </Modal>

      {/* 删除账号确认 */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="删除本账号？">
        <p className="text-sm text-ivory/80 mb-4">
          将永久删除「{nickname}」的昵称、头像与段位 XP（战绩钱包数据保留在本地）。此操作不可撤销。
        </p>
        <div className="flex gap-3">
          <Button fullWidth variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button fullWidth variant="danger" onClick={() => { deleteAccount(activeId!); setConfirmDelete(false); toast.info('账号已删除'); }}>确认删除</Button>
        </div>
      </Modal>

      {/* 重置确认 */}
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="确认重置？">
        <p className="text-sm text-ivory/80 mb-4">
          将清零欢乐豆、场次、盈亏等牌桌数据（段位 XP 与签到记录保留）。此操作不可撤销。
        </p>
        <div className="flex gap-3">
          <Button fullWidth variant="ghost" onClick={() => setConfirmReset(false)}>取消</Button>
          <Button fullWidth variant="danger" onClick={resetAll}>确认重置</Button>
        </div>
      </Modal>
    </div>
  );
}
