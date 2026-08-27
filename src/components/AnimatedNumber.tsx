// 数值滚动组件：筹码 / 底池 / 胜率等用平滑计数替代瞬间跳变（对标 PokerStars 数字动效）
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: number;
  className?: string;
  duration?: number;     // 时长 ms，默认 450
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({ value, className, duration = 450, prefix = '', suffix = '' }: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplay(value); fromRef.current = value; return; }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return (
    <span className={cn('num', className)}>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}
