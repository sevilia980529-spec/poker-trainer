/**
 * Spinner —— 金色圆环旋转 loading 指示器
 *
 * 设计要点：
 * - 默认金色 #D4A857（PokerMind 设计令牌 `gold`）
 * - 尊重 `prefers-reduced-motion`：降级为静态圆环 + 透明度脉冲（motion-reduce:animate-pulse-slow）
 * - 带 role="status" + aria-label，屏幕阅读器可感知加载状态
 * - 尺寸/颜色通过 inline style 下发，避免 Tailwind 动态类名被 purge 以及同类工具类优先级打架
 */

interface SpinnerProps {
  /** 圆环直径，单位 px，默认 20 */
  size?: number;
  /** 圆环颜色，支持任意 CSS 颜色，默认金色 #D4A857 */
  color?: string;
  /** 额外类名（仅用于布局覆写，如 `my-auto`） */
  className?: string;
}

export default function Spinner({ size = 20, color = '#D4A857', className = '' }: SpinnerProps) {
  // 线宽随尺寸自适应，最小 2px，保证小尺寸下圆环依然可见
  const borderWidth = Math.max(2, Math.round(size / 8));

  return (
    <span
      role="status"
      aria-label="加载中"
      className={[
        'inline-block shrink-0 rounded-full',
        // border-current 让四边取文字色，再把上边置为透明形成旋转缺口
        'border-current border-t-transparent',
        'animate-spin motion-reduce:animate-pulse-slow',
        className,
      ].join(' ')}
      style={{ width: size, height: size, borderWidth, color }}
    />
  );
}
