import type { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}

const VARIANT_CLASSES = {
  primary: 'bg-gold text-ink hover:bg-gold-light active:bg-gold-dark shadow-card hover:shadow-card-hover',
  secondary: 'bg-ink-card text-ivory border border-gold-dark/50 hover:bg-ink-light hover:border-gold',
  danger: 'bg-danger text-white hover:bg-red-600 shadow-card',
  success: 'bg-success text-white hover:bg-green-600 shadow-card',
  ghost: 'bg-transparent text-ivory/80 hover:bg-ink-card hover:text-ivory',
};

const SIZE_CLASSES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-base',
  lg: 'px-6 py-3.5 text-lg',
};

export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  className = '',
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        ${VARIANT_CLASSES[variant]}
        ${SIZE_CLASSES[size]}
        ${fullWidth ? 'w-full' : ''}
        font-semibold rounded-xl
        transition-all duration-150
        active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        flex items-center justify-center gap-2
        min-h-[44px]
        ${className}
      `}
    >
      {children}
    </button>
  );
}
