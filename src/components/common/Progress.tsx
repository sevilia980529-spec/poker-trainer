/**
 * Progress —— 暗金风格进度条
 *
 * 用于「数据迁移中」等需要进度反馈的场景（配合 Modal 的 dismissible={false} 使用）。
 *
 * 注意：不要复用 shadcn 的 src/components/ui/progress.tsx，那是白底体系，
 * 与本项目暗金主题冲突（和 Input 同样的问题）。
 *
 * 未知进度（indeterminate）的扫光动画定义在 src/index.css 的 .progress-sweep，
 * 并已在 prefers-reduced-motion 下降级为整条脉冲。
 */

interface ProgressProps {
  /** 当前进度 0–100，超出范围会被 clamp */
  value?: number;
  /**
   * 未知进度态：走循环扫光动画，此时忽略 value。
   * 用于迁移步骤数不确定的场景。
   */
  indeterminate?: boolean;
  /** 进度条高度，单位 px，默认 8 */
  height?: number;
  /** 额外类名，作用于外层轨道 */
  className?: string;
}

export default function Progress({
  value = 0,
  indeterminate = false,
  height = 8,
  className = '',
}: ProgressProps) {
  // 外部传入脏数据时兜底，避免宽度溢出轨道
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      // 未知进度按 ARIA 规范省略 aria-valuenow
      aria-valuenow={indeterminate ? undefined : clamped}
      className={`w-full bg-ink-light rounded-full overflow-hidden ${className}`}
      style={{ height }}
    >
      {indeterminate ? (
        // 宽度固定 30%，靠 CSS 来回位移形成扫光；降低动效时由样式改成整条脉冲
        <div className="h-full w-[30%] rounded-full bg-gradient-to-r from-gold-dark to-gold-light progress-sweep" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}
