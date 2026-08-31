import { useState } from 'react';
import Input from './Input';
import {
  PASSWORD_MAX_LENGTH,
  STRENGTH_COLORS,
  STRENGTH_FILLED_CELLS,
  checkPasswordStrength,
} from '../../utils/validate';

/**
 * PasswordInput —— 基于 Input 封装的密码输入框
 *
 * 内置右侧 44×44 眼睛按钮切换明文/密文，可选显示三格强度条。
 * 三页（注册/登录/迁移）共用这一份，避免各自重复实现眼睛按钮。
 */

interface PasswordInputProps {
  /** 密码值（受控） */
  value: string;
  /** 值变化回调 */
  onChange: (v: string) => void;
  /** 顶部标签 */
  label?: string;
  /** 错误文案，有值时边框转 danger 并优先于 hint 展示 */
  error?: string;
  /** 底部灰色提示 */
  hint?: string;
  /** 是否显示三格强度条（注册页开、登录页关），默认 false */
  showStrength?: boolean;
  /**
   * 浏览器自动填充提示。
   * 注册/改密传 'new-password'，登录传 'current-password'（默认值）。
   */
  autoComplete?: 'current-password' | 'new-password';
  /** 占位文案，默认「请输入密码」 */
  placeholder?: string;
  /** 回车提交回调 */
  onEnter?: () => void;
  /** 失焦回调 */
  onBlur?: () => void;
  /** 禁用态 */
  disabled?: boolean;
  /** 最大长度，默认 64（PRD AUTH-03 上限） */
  maxLength?: number;
  /** 额外类名，作用于最外层容器 */
  className?: string;
}

/** 眼睛图标：visible=true 为睁眼，否则为闭眼（加一道斜线） */
function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {!visible && <path d="M4 20 L20 4" />}
    </svg>
  );
}

export default function PasswordInput({
  value,
  onChange,
  label,
  error,
  hint,
  showStrength = false,
  autoComplete = 'current-password',
  placeholder = '请输入密码',
  onEnter,
  onBlur,
  disabled = false,
  maxLength = PASSWORD_MAX_LENGTH,
  className = '',
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const strength = checkPasswordStrength(value);
  const filledCells = STRENGTH_FILLED_CELLS[strength.level];
  const showStrengthBar = showStrength && value.length > 0;

  return (
    <div className={className}>
      <Input
        label={label}
        value={value}
        onChange={onChange}
        // 明文切换只影响展示，type 仍走 Input 的 password/text 分支
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        error={error}
        hint={hint}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        onBlur={onBlur}
        onEnter={onEnter}
        rightSlot={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            disabled={disabled}
            aria-label={visible ? '隐藏密码' : '显示密码'}
            aria-pressed={visible}
            className={[
              'w-11 h-11 min-w-[44px] min-h-[44px]',
              'flex items-center justify-center rounded-lg',
              'text-ivory/50 hover:text-gold',
              'transition-colors duration-150',
              'disabled:cursor-not-allowed',
            ].join(' ')}
          >
            <EyeIcon visible={visible} />
          </button>
        }
      />

      {showStrengthBar && (
        <div className="mt-2 flex items-center gap-2">
          {/* 三格进度条：纯装饰，状态通过右侧文字标签传达 */}
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1 flex-1 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor:
                    index < filledCells ? STRENGTH_COLORS[strength.level] : 'rgba(245, 239, 224, 0.15)',
                }}
              />
            ))}
          </div>
          <span
            className="text-[11px] shrink-0 tabular-nums transition-colors duration-200"
            style={{ color: STRENGTH_COLORS[strength.level] }}
            aria-live="polite"
          >
            {strength.label}
          </span>
        </div>
      )}
    </div>
  );
}
