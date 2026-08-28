// 拟真筹码：优先使用用户提供的筹码图片，加载失败回退到 CSS 3D 圆柱筹码
import { useState } from 'react';
import { cn } from '../lib/utils';

const DENOMS = [10, 20, 50, 100, 500, 1000];

function getDenom(amount: number): number {
  if (amount <= 0) return 10;
  for (let i = DENOMS.length - 1; i >= 0; i--) {
    if (amount >= DENOMS[i]) return DENOMS[i];
  }
  return DENOMS[0];
}

function chipColor(amount: number): { top: string; side: string; text: string } {
  if (amount >= 1500) return { top: 'radial-gradient(circle at 30% 30%, #f0c46e 0%, #D4A857 40%, #a67c32 100%)', side: 'linear-gradient(180deg,#c89456 0%,#a67c32 100%)', text: '#2a1f00' }; // 金
  if (amount >= 500) return { top: 'radial-gradient(circle at 30% 30%, #4b5563 0%, #1f2937 45%, #0b1220 100%)', side: 'linear-gradient(180deg,#374151 0%,#111827 100%)', text: '#e5e7eb' }; // 黑
  if (amount >= 200) return { top: 'radial-gradient(circle at 30% 30%, #34d399 0%, #166534 45%, #052e16 100%)', side: 'linear-gradient(180deg,#15803d 0%,#14532d 100%)', text: '#f0fdf4' }; // 绿
  if (amount >= 50) return { top: 'radial-gradient(circle at 30% 30%, #f87171 0%, #b91c1c 45%, #450a0a 100%)', side: 'linear-gradient(180deg,#dc2626 0%,#991b1b 100%)', text: '#fef2f2' }; // 红
  return { top: 'radial-gradient(circle at 30% 30%, #ffffff 0%, #e2e8f0 45%, #94a3b8 100%)', side: 'linear-gradient(180deg,#cbd5e1 0%,#94a3b8 100%)', text: '#1e293b' }; // 白
}

function chipTextColor(denom: number): string {
  // 白底、金底用深色字，其他深底色用金字
  if (denom === 10 || denom === 1000) return '#1a1200';
  return '#f0c46e';
}

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 独立 CSS 筹码（图片加载失败回退） */
function CssChip({ amount, size, className }: { amount?: number; size: number; className?: string }) {
  const c = chipColor(amount ?? 0);
  const wall = Math.max(3, size * 0.18);
  return (
    <span className={cn('relative inline-block select-none', className)}
      style={{ width: size, height: size }}>
      <span className="absolute left-0 right-0 bottom-0 rounded-b-full"
        style={{ height: wall, background: c.side, boxShadow: '0 2px 4px rgba(0,0,0,0.4)' }} />
      <span className="absolute left-0 right-0 top-0 flex items-center justify-center font-bold"
        style={{
          height: size - wall,
          background: c.top,
          borderRadius: '50%',
          boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.4), 0 2px 4px rgba(0,0,0,0.3)',
          color: c.text,
          fontSize: size * 0.32,
        }}>
        <span className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'repeating-conic-gradient(rgba(255,255,255,0.85) 0deg 16deg, transparent 16deg 60deg)',
            WebkitMaskImage: 'radial-gradient(circle closest-side, transparent 60%, black 62%)',
            maskImage: 'radial-gradient(circle closest-side, transparent 60%, black 62%)',
          }} />
        <span className="absolute rounded-full" style={{ inset: size * 0.16, border: '1.5px dashed rgba(255,255,255,0.45)' }} />
        {amount !== undefined && <span className="relative z-10 drop-shadow-sm">{fmt(amount)}</span>}
      </span>
    </span>
  );
}

export function Chip({ amount, size = 26, className }: { amount?: number; size?: number; className?: string }) {
  const [errored, setErrored] = useState(false);
  const denom = getDenom(amount ?? 0);
  const src = `/icons/chip-${denom}.png`;

  if (errored) {
    return <CssChip amount={amount} size={size} className={className} />;
  }

  return (
    <span className={cn('relative inline-block select-none', className)}
      style={{ width: size, height: size }}>
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setErrored(true)}
      />
      {amount !== undefined && (
        <span
          className="absolute inset-0 flex items-center justify-center font-bold"
          style={{
            color: chipTextColor(denom),
            fontSize: size * 0.32,
            textShadow: denom === 10 || denom === 1000 ? '0 1px 2px rgba(255,255,255,0.7)' : '0 1px 3px rgba(0,0,0,0.75)',
          }}>
          {fmt(amount)}
        </span>
      )}
    </span>
  );
}

/** 筹码堆：按金额叠放 1~5 枚，顶层带面值 */
export function ChipStack({ amount, size = 26, className }: { amount: number; size?: number; className?: string }) {
  const count = amount <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(amount / 1000)));
  const step = Math.max(2.5, size * 0.12);
  return (
    <span className={cn('relative inline-block', className)}
      style={{ width: size, height: size + (count - 1) * step }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="absolute left-0" style={{ bottom: i * step, zIndex: i }}>
          <Chip amount={i === count - 1 ? amount : undefined} size={size} />
        </span>
      ))}
    </span>
  );
}
