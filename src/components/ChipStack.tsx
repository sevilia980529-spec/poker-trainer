// CSS 绘制的拟真筹码：径向渐变盘面 + 边缘纹路，无需图片素材
import { cn } from '../lib/utils';

function chipColor(amount: number): { face: string; edge: string; text: string } {
  if (amount >= 1500) return { face: '#b8860b', edge: '#f5d67b', text: '#3a2a00' }; // 金
  if (amount >= 500) return { face: '#1f2937', edge: '#9ca3af', text: '#e5e7eb' };  // 黑
  if (amount >= 200) return { face: '#166534', edge: '#bbf7d0', text: '#f0fdf4' };  // 绿
  if (amount >= 50) return { face: '#b91c1c', edge: '#fecaca', text: '#fef2f2' };   // 红
  return { face: '#e2e8f0', edge: '#64748b', text: '#1e293b' };                     // 白
}

export function Chip({ amount, size = 26, className }: { amount?: number; size?: number; className?: string }) {
  const c = chipColor(amount ?? 0);
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full font-bold select-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        color: c.text,
        background: `radial-gradient(circle at 50% 42%, ${c.face} 58%, transparent 59%),
          repeating-conic-gradient(${c.edge} 0deg 24deg, ${c.face} 24deg 48deg)`,
        boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.1)}px ${c.face}, 0 2px 4px rgba(0,0,0,0.5)`,
      }}
    >
      {amount !== undefined && (amount >= 1000 ? `${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}k` : amount)}
    </span>
  );
}

/** 筹码堆：按金额显示 1~4 层叠放，顶层带面值 */
export function ChipStack({ amount, size = 26, className }: { amount: number; size?: number; className?: string }) {
  const layers = amount <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.log10(amount)));
  const step = size * 0.16;
  return (
    <span className={cn('relative inline-block', className)}
      style={{ width: size, height: size + (layers - 1) * step }}>
      {Array.from({ length: layers }).map((_, i) => (
        <span key={i} className="absolute left-0" style={{ bottom: i * step, zIndex: i }}>
          <Chip amount={i === layers - 1 ? amount : undefined} size={size} />
        </span>
      ))}
    </span>
  );
}
