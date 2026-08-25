import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  showClose?: boolean;
}

export default function Modal({ open, onClose, title, children, showClose = true }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-up"
      style={{ animationDuration: '0.15s' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-ink-card border border-gold-dark/30 rounded-2xl p-6 shadow-2xl animate-pop-scale max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-ink-light text-ivory/60 hover:text-ivory hover:bg-ink"
          >
            ✕
          </button>
        )}
        {title && <h2 className="text-xl font-bold text-gold mb-4 pr-8">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
