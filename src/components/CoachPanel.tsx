import type { GameState } from '../engine/game';
import { heroPositionName, STREET_NAME } from '../engine/game';
import type { CoachAdvice } from '../ai/coach';
import { POSITION_TIPS } from '../ai/coach';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';

const REC_LABEL: Record<string, { text: string; color: string }> = {
  fold:  { text: '弃牌 FOLD',  color: 'bg-red-600' },
  check: { text: '过牌 CHECK', color: 'bg-slate-500' },
  call:  { text: '跟注 CALL',  color: 'bg-blue-600' },
  raise: { text: '加注 RAISE', color: 'bg-emerald-600' },
};

export function CoachPanel({ state, heroIdx, advice }: {
  state: GameState;
  heroIdx: number;
  advice: CoachAdvice | null;
}) {
  const pos = heroPositionName(state, heroIdx);
  const rec = advice ? REC_LABEL[advice.recommendation] : null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* 位置 */}
      <div className="rounded-lg bg-slate-800/80 p-3 border border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-amber-300">📍 你的位置：{pos}</span>
          <Badge variant="outline" className="text-slate-300 border-slate-600">{STREET_NAME[state.street]}</Badge>
        </div>
        <p className="text-slate-400 text-xs leading-relaxed">{POSITION_TIPS[pos]}</p>
      </div>

      {/* 胜率 */}
      {advice?.equity && (
        <div className="rounded-lg bg-slate-800/80 p-3 border border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-sky-300">🎯 实时胜率（Equity）</span>
            <span className="font-mono text-lg font-bold text-sky-200">
              {(advice.equity.equity * 100).toFixed(1)}%
            </span>
          </div>
          <Progress value={advice.equity.equity * 100} className="h-2 mb-2" />
          <div className="text-xs text-slate-400 space-y-0.5">
            <p>当前牌力：<span className="text-slate-200">{advice.handDesc}</span></p>
            {advice.draws && advice.draws.outs > 0 && (
              <p>补牌数（Outs）：约 <span className="text-amber-300 font-semibold">{advice.draws.outs}</span> 张
                <span className="text-slate-500">（四二法则：转牌圈胜率 ≈ 补牌 × 2%）</span></p>
            )}
            {advice.potOdds !== undefined && (
              <p>跟注所需胜率：<span className="text-amber-300 font-semibold">{(advice.potOdds * 100).toFixed(1)}%</span>
                <span className="text-slate-500">（底池赔率换算）</span></p>
            )}
          </div>
        </div>
      )}

      {/* 教练建议 */}
      {advice && rec && (
        <div className="rounded-lg bg-slate-800/80 p-3 border border-emerald-800/60">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold text-emerald-300">🎓 教练建议</span>
            <span className={`px-2 py-0.5 rounded text-white text-xs font-bold ${rec.color}`}>
              {rec.text}{advice.recommendation === 'raise' && advice.raiseSize ? ` → ${advice.raiseSize}` : ''}
            </span>
            {advice.isBluffSpot && <Badge className="bg-purple-600">诈唬时机</Badge>}
            <span className="text-xs text-slate-500 ml-auto">
              把握度：{advice.confidence === 'high' ? '高' : advice.confidence === 'medium' ? '中' : '低'}
            </span>
          </div>
          <ul className="text-xs text-slate-300 space-y-1 leading-relaxed list-disc pl-4">
            {advice.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {advice.concepts.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {advice.concepts.map(c => (
                <Badge key={c} variant="outline" className="text-amber-200 border-amber-700 text-[10px]">{c}</Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {!advice && (
        <div className="rounded-lg bg-slate-800/80 p-3 border border-slate-700 text-slate-400 text-xs">
          轮到你行动时，教练会在这里给出实时建议与胜率分析。
        </div>
      )}
    </div>
  );
}
