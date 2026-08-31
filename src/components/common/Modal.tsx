import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** 是否显示右上角 ✕ 关闭按钮，默认 true */
  showClose?: boolean;
  /**
   * 是否允许用户主动关闭，默认 true。
   * 置为 false 时：点遮罩不关闭、按 ESC 不关闭、隐藏右上角 ✕。
   * 用于「迁移进度执行中」这类不允许中途打断的场景。
   */
  dismissible?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  showClose = true,
  dismissible = true,
}: ModalProps) {
  // Hooks 必须写在 early return 之前，否则违反 React Hooks 规则
  useEffect(() => {
    if (!open || !dismissible) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  // 不可关闭时，✕ 按钮一并隐藏
  const showCloseButton = showClose && dismissible;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-up"
      style={{ animationDuration: '0.15s' }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="relative w-full max-w-md bg-ink-card border border-gold-dark/30 rounded-2xl p-6 shadow-2xl animate-pop-scale max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-ink-light text-ivory/60 hover:text-ivory hover:bg-ink"
          >
            ✕
          </button>
        )}
        {title && (
          <h2 className={`text-xl font-bold text-gold mb-4 ${showCloseButton ? 'pr-8' : ''}`}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
