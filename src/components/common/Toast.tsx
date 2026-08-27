import { create } from 'zustand';
import Icon from '../Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, message: string, duration?: number) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (type, message, duration = 2500) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration }] }));
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const useToast = () => {
  const show = useToastStore((s) => s.show);
  return {
    success: (msg: string, dur?: number) => show('success', msg, dur),
    error: (msg: string, dur?: number) => show('error', msg, dur),
    info: (msg: string, dur?: number) => show('info', msg, dur),
    warning: (msg: string, dur?: number) => show('warning', msg, dur),
  };
};

const COLORS: Record<ToastType, string> = {
  success: 'border-success/60 bg-success/10 text-success',
  error: 'border-danger/60 bg-danger/10 text-danger',
  info: 'border-info/60 bg-info/10 text-info',
  warning: 'border-gold/60 bg-gold/10 text-gold',
};

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none safe-top">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto animate-toast-in
            px-4 py-3 rounded-xl border
            backdrop-blur-md
            flex items-center gap-3
            min-w-[200px] max-w-[90vw] shadow-lg
            ${COLORS[toast.type]}
          `}
          onClick={() => dismiss(toast.id)}
        >
          <Icon e={ICONS[toast.type]} size={16} className="font-bold" />
          <span className="text-sm font-medium text-ivory">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
