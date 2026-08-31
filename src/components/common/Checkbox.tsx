import type { ReactNode } from 'react';

/**
 * Checkbox —— 暗金风格复选框
 *
 * 视觉方块 20×20，但热区通过 label 的 min-h-[44px] + py 扩到 ≥44×44，
 * 满足移动端触控要求；点文字同样可切换。
 */

interface CheckboxProps {
  /** 是否选中（受控） */
  checked: boolean;
  /** 选中态变化回调 */
  onChange: (checked: boolean) => void;
  /** 右侧文案，支持 ReactNode（如带链接的「同意《用户协议》」） */
  label?: ReactNode;
  /** 禁用态 */
  disabled?: boolean;
  /** 额外类名，作用于最外层 label */
  className?: string;
}

export default function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}: CheckboxProps) {
  return (
    <label
      className={[
        // min-h-[44px] + py-2 保证触控热区 ≥44×44
        'inline-flex items-center gap-2.5 min-h-[44px] py-2 select-none',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      ].join(' ')}
    >
      <span className="relative flex items-center justify-center shrink-0">
        {/*
          真实 input 用 sr-only 隐藏但保留可聚焦与键盘可达性，
          视觉方块作为 peer 兄弟节点，通过 peer-checked / peer-focus-visible 同步状态。
        */}
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={[
            'w-5 h-5 rounded flex items-center justify-center border',
            'transition-all duration-150',
            checked ? 'bg-gold border-gold' : 'bg-ink-light border-gold-dark/40',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-gold/60',
          ].join(' ')}
        >
          {checked && (
            <svg
              viewBox="0 0 20 20"
              className="w-3.5 h-3.5 text-ink"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 10.5 L8 14.5 L16 5.5" />
            </svg>
          )}
        </span>
      </span>

      {label && <span className="text-sm text-ivory/80 leading-snug">{label}</span>}
    </label>
  );
}
