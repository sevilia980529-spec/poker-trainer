import { useNavigate } from 'react-router';
import { useEffect } from 'react';
import Header from '../components/common/Header';
import Button from '../components/common/Button';
import { ToastContainer, useToast } from '../components/common/Toast';
import { useUserStore, useLevel } from '../store/userStore';
import { loadProfile, saveProfile } from '../store/points';

const CHECKIN_CHIPS = 500;

export default function Home() {
  const navigate = useNavigate();
  const { level, nextLevel, progress, xpToNext } = useLevel();
  const dailyCheckin = useUserStore((s) => s.dailyCheckin);
  const lastCheckin = useUserStore((s) => s.lastDailyCheckin);
  const consecutive = useUserStore((s) => s.consecutiveLoginDays);
  const xp = useUserStore((s) => s.xp);
  const toast = useToast();

  const profile = loadProfile();
  const winRate = profile.handsPlayed > 0
    ? Math.round((profile.handsWon / profile.handsPlayed) * 100)
    : 0;

  useEffect(() => {
    // 首次进入自动签到
    if (lastCheckin === 0) {
      const result = dailyCheckin();
      if (result.isNew) {
        const p = loadProfile();
        saveProfile({ ...p, points: p.points + CHECKIN_CHIPS });
        setTimeout(() => {
          toast.success(`🎁 欢迎来到 PokerMind！签到获得 ${CHECKIN_CHIPS} 欢乐豆 + ${result.xp} XP`);
        }, 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckin = () => {
    const result = dailyCheckin();
    if (result.isNew) {
      const p = loadProfile();
      saveProfile({ ...p, points: p.points + CHECKIN_CHIPS });
      toast.success(`签到成功！获得 ${CHECKIN_CHIPS} 欢乐豆 + ${result.xp} XP`);
    } else {
      toast.info('今天已经签到过啦，明天再来~');
    }
  };

  const today = new Date().setHours(0, 0, 0, 0);
  const checkedToday = lastCheckin >= today;

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      <Header />
      <ToastContainer />

      <main className="flex-1 px-4 py-6 pb-8 space-y-6 max-w-2xl mx-auto w-full">
        {/* 段位进度卡片 */}
        <section className="glass rounded-2xl p-5 space-y-3 animate-fade-up">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-ivory/60">当前段位</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl">{level.icon}</span>
                <span className="text-xl font-bold" style={{ color: level.color }}>
                  {level.name}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ivory/60">总经验</div>
              <div className="text-xl font-bold text-gold mt-1 num">{xp.toLocaleString()} XP</div>
            </div>
          </div>

          {nextLevel && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-ivory/60">
                <span>距离 {nextLevel.name}</span>
                <span>还差 {xpToNext} XP</span>
              </div>
              <div className="h-2 bg-ink-light rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-700"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-ivory num">{profile.handsPlayed}</div>
              <div className="text-xs text-ivory/60">总场次</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-success num">{winRate}%</div>
              <div className="text-xs text-ivory/60">胜率</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-info num">{consecutive}</div>
              <div className="text-xs text-ivory/60">连续登录</div>
            </div>
          </div>
        </section>

        {/* 每日签到 */}
        <section className="glass rounded-2xl p-5 animate-fade-up" style={{ animationDelay: '0.05s' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <h3 className="font-semibold text-ivory">每日签到</h3>
              <p className="text-xs text-ivory/60 mt-0.5">
                {checkedToday ? '✅ 今日已签到，明天再来' : `领取今日 ${CHECKIN_CHIPS} 欢乐豆 + 50 XP`}
              </p>
            </div>
            <Button
              variant={checkedToday ? 'ghost' : 'primary'}
              size="sm"
              onClick={handleCheckin}
              disabled={checkedToday}
            >
              {checkedToday ? '已签到' : '签到'}
            </Button>
          </div>
        </section>

        {/* 主功能区 */}
        <section className="space-y-3 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <h2 className="text-sm font-semibold text-ivory/80 px-1">开始游戏</h2>
          <Button fullWidth size="lg" variant="primary" onClick={() => navigate('/lobby')} className="!py-4">
            <span className="text-xl">♠</span>
            <span>德州训练</span>
            <span className="text-xs opacity-70">单人对战 AI</span>
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <Button fullWidth variant="secondary" onClick={() => navigate('/training')}>
              <div className="flex flex-col items-center">
                <span className="text-xl mb-0.5">🎯</span>
                <span>专项练习</span>
              </div>
            </Button>
            <Button fullWidth variant="secondary" onClick={() => navigate('/room')}>
              <div className="flex flex-col items-center">
                <span className="text-xl mb-0.5">👥</span>
                <span>好友房</span>
              </div>
            </Button>
          </div>

          <Button
            fullWidth
            variant="secondary"
            onClick={() => navigate('/blackjack')}
            className="!py-3 bg-gradient-to-r from-red-900/40 to-red-950/50 border-red-700/50"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🃏</span>
              <div className="flex-1 text-left">
                <div className="text-ivory font-bold">21点训练</div>
                <div className="text-xs text-ivory/60">跟庄家对玩，Basic Strategy</div>
              </div>
              <span className="text-ivory/60">→</span>
            </div>
          </Button>
        </section>

        <div className="text-center text-xs text-ivory/30 pt-4">
          PokerMind · AI 德州陪练 · 让你成为更好的牌手
        </div>
      </main>
    </div>
  );
}
