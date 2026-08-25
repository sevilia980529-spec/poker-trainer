// 专项训练页面：情景刷题
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { genDrill, DRILL_CATEGORY_INFO, type Drill, type DrillCategory } from '../ai/drills';
import { loadDrillStats, recordAnswer, DRILL_REWARD, type DrillStats } from '../store/drillStats';
import { loadProfile, saveProfile } from '../store/points';
import { PlayingCard } from '../components/PlayingCard';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

const CATEGORIES = Object.keys(DRILL_CATEGORY_INFO) as DrillCategory[];

export default function Drills() {
  const [category, setCategory] = useState<DrillCategory>('preflop');
  const [drill, setDrill] = useState<Drill>(() => genDrill('preflop'));
  const [picked, setPicked] = useState<string | null>(null);
  const [stats, setStats] = useState<DrillStats>(loadDrillStats);

  const nextDrill = useCallback((cat: DrillCategory) => {
    setDrill(genDrill(cat));
    setPicked(null);
  }, []);

  const choose = useCallback((value: string) => {
    if (picked) return; // 已作答
    setPicked(value);
    const isCorrect = value === drill.correct;
    setStats(recordAnswer(loadDrillStats(), drill.category, isCorrect));
    if (isCorrect) {
      const p = loadProfile();
      saveProfile({ ...p, points: p.points + DRILL_REWARD });
    }
  }, [picked, drill]);

  const answered = picked !== null;
  const isCorrect = picked === drill.correct;
  const catInfo = DRILL_CATEGORY_INFO[drill.category];
  const acc = stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900/60">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">← 牌桌</Link>
        <Link to="/blackjack" className="text-slate-400 hover:text-slate-200 text-sm">♣ 21点</Link>
        <h1 className="text-lg font-bold">🎯 专项训练</h1>
        <div className="text-xs text-slate-400 flex gap-3 ml-auto">
          <span>已答 {stats.answered}</span>
          <span>正确率 {acc}%</span>
          <span>连对 🔥{stats.streak}</span>
          <span>最佳连对 {stats.bestStreak}</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center p-6 gap-5 max-w-2xl mx-auto w-full">
        {/* 分类选择 */}
        <div className="flex gap-2 flex-wrap justify-center">
          {CATEGORIES.map(c => {
            const info = DRILL_CATEGORY_INFO[c];
            const cs = stats.perCategory[c];
            return (
              <button key={c}
                onClick={() => { setCategory(c); nextDrill(c); }}
                className={cn('px-3 py-2 rounded-lg border text-sm transition',
                  category === c
                    ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500')}>
                <div className="font-semibold">{info.icon} {info.name}</div>
                <div className="text-[10px] text-slate-500">{info.desc}
                  {cs ? ` · ${cs.correct}/${cs.answered}` : ''}</div>
              </button>
            );
          })}
        </div>

        {/* 题目卡片 */}
        <div className="w-full rounded-xl bg-slate-900 border border-slate-700 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Badge className="bg-slate-700">{catInfo.icon} {catInfo.name}</Badge>
          </div>
          <p className="leading-relaxed text-slate-100">{drill.prompt}</p>
          {drill.detail && (
            <p className="text-xs text-slate-400 font-mono bg-slate-800/70 rounded px-2 py-1.5">{drill.detail}</p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
              {drill.heroCards.map((c, i) => <PlayingCard key={i} card={c} />)}
            </div>
            {drill.board.length > 0 && (
              <>
                <span className="text-slate-600 text-xs">公共牌 →</span>
                <div className="flex gap-1.5">
                  {drill.board.map((c, i) => <PlayingCard key={i} card={c} />)}
                </div>
              </>
            )}
          </div>

          {/* 选项 */}
          <div className="grid gap-2">
            {drill.options.map(o => {
              const isRight = answered && o.value === drill.correct;
              const isWrongPick = answered && o.value === picked && !isCorrect;
              return (
                <button key={o.value} onClick={() => choose(o.value)} disabled={answered}
                  className={cn('px-4 py-3 rounded-lg border text-left font-semibold transition',
                    !answered && 'bg-slate-800 border-slate-600 hover:border-amber-500 hover:bg-slate-700',
                    isRight && 'bg-emerald-900/50 border-emerald-500 text-emerald-200',
                    isWrongPick && 'bg-red-900/50 border-red-500 text-red-200',
                    answered && !isRight && !isWrongPick && 'bg-slate-800/50 border-slate-700 text-slate-500')}>
                  {o.label}
                  {isRight && ' ✅'}
                  {isWrongPick && ' ❌'}
                </button>
              );
            })}
          </div>

          {/* 解析 */}
          {answered && (
            <div className={cn('rounded-lg p-3 border text-sm leading-relaxed whitespace-pre-line',
              isCorrect ? 'bg-emerald-950/40 border-emerald-800' : 'bg-red-950/40 border-red-800')}>
              <p className="font-bold mb-1">
                {isCorrect ? `回答正确！+${DRILL_REWARD} 积分 🎉` : '答错了，看解析 👇'}
              </p>
              <p className="text-slate-300">{drill.explanation}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {drill.concepts.map(c => (
                  <span key={c} className="text-[10px] text-amber-300/80">#{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {answered && (
          <Button size="lg" className="bg-amber-600 hover:bg-amber-500 px-8" onClick={() => nextDrill(category)}>
            下一题 ▶
          </Button>
        )}
      </main>
    </div>
  );
}
