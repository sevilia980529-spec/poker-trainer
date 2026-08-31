import type { ReactNode } from 'react';

/**
 * Divider —— 两侧横线 + 中间文字的分割线
 *
 * 典型场景：表单下方的「───── 或 ─────」，用于区隔第三方登录等次级入口。
 * 两侧横线是纯装饰，对屏幕阅读器隐藏；中间文字正常可读。
 */

interface DividerProps {
  /** 中间文字，默认「或」 */
  children?: ReactNode;
  /** 额外类名，作用于最外层容器 */
  className?: string;
}

export default function Divider({ children = '或', className = '' }: DividerProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span aria-hidden="true" className="flex-1 h-px bg-ivory/30" />
      <span className="text-xs text-ivory/30 shrink-0">{children}</span>
      <span aria-hidden="true" className="flex-1 h-px bg-ivory/30" />
    </div>
  );
}
