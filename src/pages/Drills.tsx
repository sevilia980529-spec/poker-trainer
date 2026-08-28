// 专项训练页面：情景刷题
import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { genDrill, DRILL_CATEGORY_INFO, type Drill, type DrillCategory } from '../ai/drills';
import { loadDrillStats, recordAnswer, DRILL_REWARD, type DrillStats } from '../store/drillStats';
import { loadProfile, saveProfile } from '../store/points';
import { useUserStore } from '../store/userStore';
import { PlayingCard } from '../components/PlayingCard';
import Icon from '../components/Icon';
import { RulesGuideDialog } from '../components/RulesGuide';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';

const CATEGORIES = Object.keys(DRILL_CATEGORY_INFO) as DrillCategory[];

export default function Drills() {
  const [searchParams] = useSearchParams();
  const initCat = (() => {
    const c = searchParams.get('cat');
    return c && c in DRILL_CATEGORY_INFO ? (c as DrillCategory) : 'preflop';
  })();
  const [category, setCategory] = useState<DrillCategory>(initCat);
  const [drill, setDrill] = useState<Drill>(() => genDrill(initCat));
  const [picked, setPicked] = useState<string | null>(null);
  const [stats, setStats] = useState<DrillStats>(loadDrillStats);
  const [showRules, setShowRules] = useState(false);

  const nextDrill = useCallback((cat: DrillCategory) => {
    setDrill(genDrill(cat));
    setPicked(null);
  }, []);

  const choose = useCallback((value: string) => {
    if (picked) return; // 已作答
    setPicked(value);
    const isCorrect = value === drill.correct;
    setStats(recordAnswer(loadDrillStats(), drill.category, isCorrect));
    useUserStore.getState().addXP(isCorrect ? 5 : 2);
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
    <div className="min-h-screen bg-ink text-ivory flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-ink-light bg-ink-card/60 flex-wrap safe-top">
        <Link to="/training" className="text-ivory/60 hover:text-ivory text-sm"><Icon e="←" size={14} className="align-middle" /> 训练中心</Link>
        <Link to="/" className="text-ivory/60 hover:text-ivory text-sm"><Icon e="🏠" size={14} className="align-middle" /> 首页</Link>
        <h1 className="text-lg font-bold"><Icon e="🎯" size={16} className="align-middle" /> 专项训练</h1>
        <button onClick={() => setShowRules(true)} className="text-ivory/60 hover:text-ivory text-sm"><Icon e="📖" size={14} className="align-middle" /> 规则术语</button>
        <div className="text-xs text-ivory/60 flex gap-3 ml-auto">
          <span>已答 {stats.answered}</span>
          <span>正确率 {acc}%</span>
          <span>连对 <Icon e="🔥" size={12} className="align-middle" />{stats.streak}</span>
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
                    ? 'bg-white border-gold text-gold shadow-sm'
                    : 'bg-white/80 border-white/60 text-ink hover:bg-white')}>
                <div className="font-semibold"><Icon name={info.icon} size={16} className="align-middle" /> {info.name}</div>
                <div className="text-[10px] text-ivory/40">{info.desc}
                  {cs ? ` · ${cs.correct}/${cs.answered}` : ''}</div>
              </button>
            );
          })}
        </div>

        {/* 题目卡片 */}
        <div className="w-full rounded-xl bg-ink-card border border-ink-light p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Badge className="bg-ink-light"><Icon name={catInfo.icon} size={14} className="align-middle" /> {catInfo.name}</Badge>
          </div>
          <p className="leading-relaxed text-ivory">{drill.prompt}</p>
          {drill.detail && (
            <p className="text-xs text-ivory/60 font-mono bg-ink-light/70 rounded px-2 py-1.5">{drill.detail}</p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
              {drill.heroCards.map((c, i) => <PlayingCard key={i} card={c} />)}
            </div>
            {drill.board.length > 0 && (
              <>
                <span className="text-ivory/40 text-xs">公共牌 <Icon e="→" size={12} className="align-middle" /></span>
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
                    !answered && 'bg-white border-white/70 text-ink hover:border-gold hover:bg-white',
                    isRight && 'bg-emerald-600 border-emerald-400 text-white',
                    isWrongPick && 'bg-red-600 border-red-400 text-white',
                    answered && !isRight && !isWrongPick && 'bg-white/50 border-white/40 text-ink/50')}>
                  {o.label}
                  {isRight && <Icon e="✅" size={12} className="align-middle" />}
                  {isWrongPick && <Icon e="❌" size={12} className="align-middle" />}
                </button>
              );
            })}
          </div>

          {/* 解析 */}
          {answered && (
            <div className={cn('rounded-lg p-3 border text-sm leading-relaxed whitespace-pre-line',
              isCorrect ? 'bg-emerald-950/40 border-emerald-800' : 'bg-red-950/40 border-red-800')}>
              <p className="font-bold mb-1">
                {isCorrect ? (
                  <span>回答正确！+{DRILL_REWARD} 积分 <Icon e="🎉" size={14} className="align-middle" /></span>
                ) : (
                  <span>答错了，看解析 <Icon e="👇" size={14} className="align-middle" /></span>
                )}
              </p>
              <p className="text-ivory">{drill.explanation}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {drill.concepts.map(c => (
                  <span key={c} className="text-[10px] text-gold-light/80">#{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {answered && (
          <Button size="lg" className="bg-gold hover:bg-gold px-8" onClick={() => nextDrill(category)}>
            下一题 ▶
          </Button>
        )}
      </main>

      <RulesGuideDialog open={showRules} onOpenChange={setShowRules} />
    </div>
  );
}
