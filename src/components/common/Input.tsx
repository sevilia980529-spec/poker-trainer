import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Input —— 暗色玻璃拟态体系下的单行输入框
 *
 * 与 shadcn 的 `src/components/ui/input.tsx`（白底）区分开，本组件专为
 * PokerMind 暗金主题设计：48px 高、ink-light 底、gold-dark 描边、聚焦金色光晕。
 *
 * 注意：不要复用 ui/input.tsx，两者的视觉体系冲突。
 */

interface InputProps {
  /** 顶部标签，12px ivory/60 */
  label?: string;
  /** 输入值（受控） */
  value: string;
  /** 值变化回调 */
  onChange: (v: string) => void;
  /** 输入类型 */
  type?: 'text' | 'email' | 'password';
  /** 占位文案 */
  placeholder?: string;
  /** 错误文案，有值时边框转 danger 且优先于 hint 展示 */
  error?: string;
  /** 底部灰色提示，11px ivory/40 */
  hint?: string;
  /** 最大输入长度 */
  maxLength?: number;
  /** 右侧插槽，如密码明文切换的 44×44 眼睛按钮 */
  rightSlot?: ReactNode;
  /** 右下角补充内容，如字数计数 */
  suffix?: ReactNode;
  /** 禁用态 */
  disabled?: boolean;
  /** 浏览器自动填充提示，如 'email' / 'current-password' / 'new-password' */
  autoComplete?: string;
  /** 移动端软键盘类型 */
  inputMode?: 'text' | 'email' | 'numeric';
  /** 失焦回调 */
  onBlur?: () => void;
  /** 回车提交回调（移动端键盘 Go 键） */
  onEnter?: () => void;
  /** 额外类名，作用于最外层容器 */
  className?: string;
}

export default function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  maxLength,
  rightSlot,
  suffix,
  disabled = false,
  autoComplete,
  inputMode,
  onBlur,
  onEnter,
  className = '',
}: InputProps) {
  const inputId = useId();
  const messageId = `${inputId}-msg`;
  const inputRef = useRef<HTMLInputElement>(null);

  const hasError = Boolean(error);
  // 底部信息行：error 优先于 hint；suffix 常驻右侧，三者任一存在即渲染
  const message = hasError ? error : hint;
  const showMessageRow = Boolean(message) || Boolean(suffix);

  /**
   * 聚焦时把输入框滚动到视口中央。
   * 移动端软键盘弹出会压缩可视高度，不滚动的话输入框极易被键盘遮挡。
   */
  const handleFocus = (): void => {
    inputRef.current?.scrollIntoView({ block: 'center' });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onEnter?.();
  };

  const borderClasses = hasError
    ? 'border-danger focus:border-danger focus:shadow-glow-danger'
    : 'border-gold-dark/40 focus:border-gold focus:shadow-glow-gold';

  return (
    <div className={['w-full', disabled ? 'opacity-50' : '', className].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={inputId} className="block text-xs text-ivory/60 mb-1.5">
          {label}
        </label>
      )}

      <div className="relative w-full">
        <input
          ref={inputRef}
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={showMessageRow ? messageId : undefined}
          className={[
            // 48px 高，16px 字号（防止 iOS Safari 聚焦时自动放大页面）
            'w-full h-12 min-h-[48px] px-4 text-base text-ivory',
            'bg-ink-light rounded-lg border',
            'placeholder:text-ivory/30',
            'transition-all duration-150',
            'focus:outline-none',
            borderClasses,
            'disabled:cursor-not-allowed',
            rightSlot ? 'pr-14' : 'pr-4',
          ].join(' ')}
        />

        {rightSlot && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-w-[44px] min-h-[44px]">
            {rightSlot}
          </div>
        )}
      </div>

      {showMessageRow && (
        <div id={messageId} className="mt-1.5 flex items-start justify-between gap-3">
          <p className={hasError ? 'text-xs text-danger' : 'text-[11px] text-ivory/40'}>
            {message}
          </p>
          {suffix && <span className="shrink-0 text-[11px] text-ivory/40">{suffix}</span>}
        </div>
      )}
    </div>
  );
}
