import { useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import LevelBadge from '../components/common/LevelBadge';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { ToastContainer, useToast } from '../components/common/Toast';
import { useUserStore, useLevel, AVATARS } from '../store/userStore';
import { loadProfile, saveProfile, defaultProfile, claimRelief, DAILY_BONUS, BUY_IN } from '../store/points';
import { loadDrillStats } from '../store/drillStats';

export default function Profile() {
  const nickname = useUserStore((s) => s.nickname);
  const avatar = useUserStore((s) => s.avatar);
  const xp = useUserStore((s) => s.xp);
  const consecutive = useUserStore((s) => s.consecutiveLoginDays);
  const setNickname = useUserStore((s) => s.setNickname);
  const setAvatar = useUserStore((s) => s.setAvatar);
  const { level, nextLevel, progress, xpToNext } = useLevel();
  const toast = useToast();

  const [profile, setProfile] = useState(loadProfile);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(nickname);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
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
    setNickname(nameInput);
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
              onClick={() => setShowAvatarPicker(true)}
              className="w-16 h-16 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-3xl shadow-md active:scale-95 transition-transform"
            >
              {avatar}
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
                  {nickname} ✏️
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

        {/* 操作 */}
        <section className="space-y-3 animate-fade-up" style={{ animationDelay: '0.15s' }}>
          {profile.points < BUY_IN && (
            <Button fullWidth variant="primary" onClick={relief}>
              💰 欢乐豆不足，领取补给 +{DAILY_BONUS.toLocaleString()}
            </Button>
          )}
          <Button fullWidth variant="ghost" onClick={() => setConfirmReset(true)}>
            重置战绩数据
          </Button>
        </section>

        <div className="text-center text-xs text-ivory/30 pt-2">
          数据保存在本机浏览器 · 清缓存会丢失
        </div>
      </main>

      {/* 头像选择 */}
      <Modal open={showAvatarPicker} onClose={() => setShowAvatarPicker(false)} title="选择头像">
        <div className="grid grid-cols-4 gap-3">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => { setAvatar(a); setShowAvatarPicker(false); }}
              className={`text-3xl p-3 rounded-xl transition-all active:scale-95
                ${a === avatar ? 'bg-gold/20 ring-2 ring-gold' : 'bg-ink-light hover:bg-ink'}`}
            >
              {a}
            </button>
          ))}
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
