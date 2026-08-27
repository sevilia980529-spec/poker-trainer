import { useNavigate } from 'react-router';
import { useState } from 'react';
import Header from '../components/common/Header';
import { loadDrillStats } from '../store/drillStats';
import { DRILL_CATEGORY_INFO, type DrillCategory } from '../ai/drills';
import { RulesGuideDialog } from '../components/RulesGuide';
import Icon from '../components/Icon';

const TRAININGS: { key: DrillCategory; color: string }[] = [
  { key: 'preflop', color: 'from-orange-600 to-orange-400' },
  { key: 'potodds', color: 'from-green-600 to-green-400' },
  { key: 'bluff', color: 'from-purple-600 to-purple-400' },
  { key: 'betsize', color: 'from-red-600 to-red-400' },
  { key: 'blackjack', color: 'from-red-700 to-red-900' },
];

export default function TrainingHub() {
  const navigate = useNavigate();
  const stats = loadDrillStats();
  const [showRules, setShowRules] = useState(false);

  const totalAcc = stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      <Header />
      <main className="flex-1 px-4 py-6 pb-8 max-w-2xl mx-auto w-full space-y-4">
        <div className="text-center mb-2 animate-fade-up">
          <h1 className="text-2xl font-bold text-gold mb-1"><Icon e="🎯" size={20} className="align-middle" /> 专项练习</h1>
          <p className="text-sm text-ivory/60">练好技术再上桌</p>
        </div>

        {/* 总览条 */}
        <div className="glass rounded-2xl p-4 flex items-center justify-between animate-fade-up" style={{ animationDelay: '0.05s' }}>
          <div>
            <div className="font-semibold text-ivory"><Icon e="📊" size={16} className="align-middle" /> 训练总览</div>
            <div className="text-xs text-ivory/60 mt-0.5">
              已练 {stats.answered} 题 · 总正确率 {totalAcc}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gold num"><Icon e="🔥" size={16} className="align-middle" /> {stats.streak}</div>
            <div className="text-xs text-ivory/60">当前连对</div>
          </div>
        </div>

        {/* 规则术语入口 */}
        <button
          onClick={() => setShowRules(true)}
          className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-left active:scale-[0.98] transition-transform animate-fade-up"
          style={{ animationDelay: '0.08s' }}
        >
          <div className="text-3xl"><Icon e="📖" size={28} className="align-middle" /></div>
          <div className="flex-1">
            <div className="font-bold text-ivory">规则与术语</div>
            <div className="text-xs text-ivory/60 mt-0.5">位置名称、行动术语、牌型大小，新手先看这里</div>
          </div>
          <div className="text-ivory/40 text-xl"><Icon e="→" size={20} className="align-middle" /></div>
        </button>

        <div className="space-y-3">
          {TRAININGS.map((t, i) => {
            const info = DRILL_CATEGORY_INFO[t.key];
            const s = stats.perCategory[t.key];
            const accuracy = s && s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : null;
            return (
              <button
                key={t.key}
                onClick={() => navigate(`/drills?cat=${t.key}`)}
                className={`
                  w-full text-left rounded-2xl p-4
                  bg-gradient-to-br ${t.color}
                  active:scale-[0.98] transition-transform animate-fade-up
                `}
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                <div className="flex items-center gap-3">
                  <div className="text-4xl"><Icon name={info.icon} size={32} className="align-middle" /></div>
                  <div className="flex-1">
                    <div className="font-bold text-white text-lg">{info.name}</div>
                    <div className="text-xs text-white/80 mt-0.5">{info.desc}</div>
                    <div className="flex gap-3 mt-2 text-xs text-white/90">
                      <span>已练: {s?.answered ?? 0}</span>
                      <span>准确率: {accuracy !== null ? `${accuracy}%` : '-'}</span>
                    </div>
                  </div>
                  <div className="text-white text-2xl"><Icon e="→" size={22} className="align-middle" /></div>
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <RulesGuideDialog open={showRules} onOpenChange={setShowRules} />
    </div>
  );
}
