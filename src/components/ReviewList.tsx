import type { GradedAction } from '../ai/coach';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

const GRADE_STYLE: Record<string, { label: string; cls: string }> = {
  excellent: { label: '优秀', cls: 'bg-emerald-600 text-white' },
  good:      { label: '良好', cls: 'bg-sky-600 text-white' },
  ok:        { label: '一般', cls: 'bg-amber-600 text-white' },
  mistake:   { label: '失误', cls: 'bg-red-600 text-white' },
};

export function ReviewList({ actions }: { actions: GradedAction[] }) {
  if (actions.length === 0) {
    return <p className="text-slate-400 text-xs">本手牌你没有做出决策（可能未入池或全下提前结束）。</p>;
  }
  return (
    <ScrollArea className="max-h-64">
      <div className="space-y-2 pr-2">
        {actions.map((a, i) => {
          const g = GRADE_STYLE[a.grade] ?? GRADE_STYLE.ok;
          return (
            <div key={i} className="rounded-md bg-slate-800/70 border border-slate-700 p-2">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-slate-300 border-slate-600 text-[10px]">{a.street}</Badge>
                <span className="text-sm font-semibold text-slate-100">{a.action}</span>
                <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${g.cls}`}>{g.label}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{a.comment}</p>
              {a.concepts.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {a.concepts.map(c => (
                    <span key={c} className="text-[10px] text-amber-300/80">#{c}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
