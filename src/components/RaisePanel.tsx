// 加注面板：手动输入筹码 + 快捷尺度 + 内缩滑杆（避免贴边误触，手机端更好操作）
import { useEffect, useState } from 'react';
import { Slider } from './ui/slider';
import { cn } from '../lib/utils';

interface Props {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  pot: number;             // 当前底池（用于快捷尺度）
  bigBlind: number;
  accent?: 'gold' | 'amber'; // 数字/高亮配色（好友房用 amber 贴合牌桌）
}

export default function RaisePanel({
  min, max, step = 10, value, onChange, pot, bigBlind, accent = 'gold',
}: Props) {
  const [text, setText] = useState(String(value));

  // 滑杆/快捷按钮改动数值时，同步回输入框
  useEffect(() => { setText(String(value)); }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (raw: string) => {
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (Number.isNaN(n)) { setText(String(value)); return; }
    onChange(clamp(n));
  };

  const snap = (n: number) => Math.round(n / step) * step;
  const presets = [
    { label: '3BB', v: snap(Math.max(bigBlind * 3, min)) },
    { label: '1/2 底池', v: snap(Math.max(pot * 0.5, min)) },
    { label: '2/3 底池', v: snap(Math.max(pot * 0.66, min)) },
    { label: '1 倍底池', v: snap(Math.max(pot, min)) },
    { label: '全下', v: max },
  ].filter(p => p.v >= min && p.v <= max);

  const numColor = accent === 'gold' ? 'text-gold' : 'text-amber-300';
  const focusRing = accent === 'gold' ? 'focus:border-gold' : 'focus:border-amber-400';
  const activeChip = accent === 'gold'
    ? 'bg-gold/20 border-gold text-gold'
    : 'bg-amber-500/20 border-amber-400/70 text-amber-200';

  return (
    <div className="w-full max-w-md space-y-2.5">
      {/* 金额：− / 手输 / ＋ （点中间可直接输入精确筹码） */}
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="减少" onClick={() => onChange(clamp(value - step))}
          className="w-11 h-11 shrink-0 rounded-full bg-white/10 border border-white/15 text-2xl leading-none text-ivory/90 active:scale-95 transition select-none">−</button>
        <div className="relative">
          <input
            value={text}
            inputMode="numeric"
            aria-label="下注筹码"
            onChange={e => setText(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            onBlur={() => commit(text)}
            onKeyDown={e => { if (e.key === 'Enter') { commit(text); e.currentTarget.blur(); } }}
            className={cn(
              'w-36 text-center text-3xl font-extrabold font-mono num',
              'bg-black/45 border border-white/15 rounded-xl py-1.5 outline-none transition',
              numColor, focusRing,
            )}
          />
          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-ivory/40 whitespace-nowrap">
            可输入 {min} ~ {max}
          </span>
        </div>
        <button type="button" aria-label="增加" onClick={() => onChange(clamp(value + step))}
          className="w-11 h-11 shrink-0 rounded-full bg-white/10 border border-white/15 text-2xl leading-none text-ivory/90 active:scale-95 transition select-none">＋</button>
      </div>

      {/* 滑杆：两侧留白 + 上下留空，避免贴屏幕边缘误触 */}
      <div className="px-6 pt-5 pb-1">
        <Slider className="brand-slider" min={min} max={max} step={step}
          value={[value]} onValueChange={v => onChange(v[0])} />
      </div>

      {/* 快捷尺度 */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap px-2">
        {presets.map(p => (
          <button key={p.label} type="button" onClick={() => onChange(clamp(p.v))}
            className={cn('text-[11px] px-2.5 py-1 rounded-full border transition active:scale-95 select-none',
              value === p.v ? activeChip : 'bg-white/[0.06] border-white/10 text-ivory/70')}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
