import type { ReactNode } from 'react';
import Spinner from './Spinner';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  /** 加载态：内部替换 children 为 Spinner，按钮置灰不可点，且不触发 active 缩放。默认 false */
  loading?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}

const VARIANT_CLASSES = {
  primary: 'bg-gold text-ink hover:bg-gold-light active:bg-gold-dark',
  secondary: 'bg-ink-card text-ivory border border-gold-dark/50 hover:bg-ink-light hover:border-gold',
  danger: 'bg-danger text-white hover:bg-red-600',
  success: 'bg-success text-white hover:bg-green-600',
  ghost: 'bg-transparent text-ivory/80 hover:bg-ink-card hover:text-ivory',
};

const SIZE_CLASSES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-base',
  // lg 实测高度 = py-3.5(14×2) + text-lg 行高(28) = 56px，已满足 PRD「主按钮 ≥52px」；
  // 下方按 size 下发的 min-h 再兜一层 52px，防止 children 为纯图标时高度塌到 52px 以下
  lg: 'px-6 py-3.5 text-lg',
};

/** Spinner 尺寸随按钮尺寸联动 */
const SPINNER_SIZE = {
  sm: 14,
  md: 18,
  lg: 20,
};

/**
 * Spinner 圆环颜色按按钮底色取反，保证在实心背景上依然可见。
 * primary 是金底，必须用墨黑环；danger/success 是深红/深绿底，用白色环。
 * 走 inline style 下发，不依赖 Tailwind 同类工具类的输出顺序。
 */
const SPINNER_COLOR = {
  primary: '#0A0A0A',
  secondary: '#D4A857',
  danger: '#FFFFFF',
  success: '#FFFFFF',
  ghost: '#D4A857',
};

export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
}: ButtonProps) {
  // 加载态强制禁用，避免重复提交
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`
        ${VARIANT_CLASSES[variant]}
        ${SIZE_CLASSES[size]}
        ${fullWidth ? 'w-full' : ''}
        relative
        font-semibold rounded-xl
        transition-all duration-150
        ${loading ? '' : 'active:scale-95'}
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        flex items-center justify-center gap-2
        ${size === 'lg' ? 'min-h-[52px]' : 'min-h-[44px]'}
        ${className}
      `}
    >
      {/*
        加载时用 invisible 而非卸载 children：
        visibility:hidden 保留布局占位，按钮宽度不会塌陷变窄，避免布局跳动。
      */}
      <span className={`flex items-center justify-center gap-2 ${loading ? 'invisible' : ''}`}>
        {children}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={SPINNER_SIZE[size]} color={SPINNER_COLOR[variant]} />
        </span>
      )}
    </button>
  );
}
