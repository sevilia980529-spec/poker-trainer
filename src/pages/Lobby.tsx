import { useState } from 'react';
import { useNavigate } from 'react-router';
import Header from '../components/common/Header';
import Button from '../components/common/Button';
import { saveTableConfig, loadTableConfig, BLIND_OPTIONS, type AIDifficulty } from '../lib/tableConfig';

const DIFFICULTIES: { value: AIDifficulty; label: string; emoji: string; desc: string; color: string }[] = [
  { value: 'easy', label: '新手', emoji: '🌱', desc: '松散被动', color: 'from-green-600 to-green-400' },
  { value: 'normal', label: '进阶', emoji: '🔥', desc: '有策略性', color: 'from-orange-600 to-orange-400' },
  { value: 'hard', label: '高手', emoji: '⚡', desc: '紧凶精准', color: 'from-red-600 to-red-400' },
  { value: 'gto', label: 'GTO', emoji: '👑', desc: '理论最优', color: 'from-purple-600 to-purple-400' },
];

const PLAYER_COUNTS = [
  { value: 2, label: '2 人桌（1v1）' },
  { value: 4, label: '4 人桌' },
  { value: 6, label: '6 人桌' },
];

export default function Lobby() {
  const navigate = useNavigate();
  const saved = loadTableConfig();
  const [difficulty, setDifficulty] = useState<AIDifficulty>(saved.difficulty);
  const [playerCount, setPlayerCount] = useState(saved.playerCount);
  const [blinds, setBlinds] = useState<[number, number]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('poker-blinds') ?? '[10,20]');
      if (Array.isArray(v) && v.length === 2) return [v[0], v[1]];
    } catch { /* ignore */ }
    return [10, 20];
  });

  const handleStart = () => {
    saveTableConfig({ playerCount, difficulty });
    try { localStorage.setItem('poker-blinds', JSON.stringify(blinds)); } catch { /* ignore */ }
    navigate('/game');
  };

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      <Header />
      <main className="flex-1 px-4 py-6 pb-8 max-w-2xl mx-auto w-full space-y-6">
        <div className="text-center animate-fade-up">
          <h1 className="text-2xl font-bold text-gold mb-1">选择对手</h1>
          <p className="text-sm text-ivory/60">挑个难度，开干！</p>
        </div>

        {/* 难度选择 */}
        <section className="space-y-2 animate-fade-up" style={{ animationDelay: '0.05s' }}>
          <h2 className="text-sm font-semibold text-ivory/80 px-1">AI 难度</h2>
          <div className="grid grid-cols-2 gap-3">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDifficulty(d.value)}
                className={`
                  relative rounded-2xl p-4 text-left transition-all
                  ${difficulty === d.value
                    ? 'bg-gradient-to-br ' + d.color + ' scale-[1.03]'
                    : 'bg-ink-card border border-white/5'}
                `}
              >
                <div className="text-3xl mb-1">{d.emoji}</div>
                <div className="font-bold text-ivory">{d.label}</div>
                <div className="text-xs text-ivory/70 mt-0.5">{d.desc}</div>
                {difficulty === d.value && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white text-ink flex items-center justify-center text-xs font-bold">✓</div>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 桌人数 */}
        <section className="space-y-2 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <h2 className="text-sm font-semibold text-ivory/80 px-1">桌人数</h2>
          <div className="grid grid-cols-3 gap-2">
            {PLAYER_COUNTS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlayerCount(p.value)}
                className={`
                  rounded-xl p-3 text-center transition-all
                  ${playerCount === p.value
                    ? 'bg-gold text-ink'
                    : 'bg-ink-card text-ivory border border-white/5'}
                `}
              >
                <div className="text-2xl mb-0.5 num">{p.value}</div>
                <div className="text-xs">{p.label}</div>
              </button>
            ))}
          </div>
        </section>

        {/* 盲注 */}
        <section className="space-y-2 animate-fade-up" style={{ animationDelay: '0.15s' }}>
          <h2 className="text-sm font-semibold text-ivory/80 px-1">盲注（最低下注）</h2>
          <div className="grid grid-cols-4 gap-2">
            {BLIND_OPTIONS.map(([sb, bb]) => (
              <button
                key={bb}
                onClick={() => setBlinds([sb, bb])}
                className={`
                  rounded-xl py-3 text-center font-bold transition-all num
                  ${blinds[1] === bb
                    ? 'bg-gold text-ink'
                    : 'bg-ink-card text-ivory border border-white/5'}
                `}
              >
                {sb}/{bb}
              </button>
            ))}
          </div>
        </section>

        {/* 配置摘要 */}
        <section className="glass rounded-2xl p-4 space-y-2 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ivory/60">上桌带入</span>
            <span className="text-lg font-bold text-gold num">2,000</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ivory/60">盲注</span>
            <span className="text-sm text-ivory num">{blinds[0]} / {blinds[1]}</span>
          </div>
        </section>

        <Button fullWidth size="lg" onClick={handleStart} className="!py-4 animate-fade-up" >
          <span className="text-xl">♠</span>
          开始对战
        </Button>
      </main>
    </div>
  );
}
