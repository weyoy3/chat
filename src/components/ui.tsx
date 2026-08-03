import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ToastState {
  message: string;
  id: number;
}

let toastFn: ((msg: string) => void) | null = null;

export function showToast(message: string) {
  toastFn?.(message);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { message, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  useEffect(() => {
    toastFn = push;
    return () => { toastFn = null; };
  }, [push]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-slide-up flex items-center gap-2 rounded-full bg-surface-container-highest md-elevated-3 px-5 py-3 text-on-surface text-sm font-medium"
        >
          <CheckCircle2 className="w-4 h-4 text-success" />
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-6" style={{ background: 'var(--md-scrim)' }}>
      <div className="animate-scale-in bg-surface-container-lowest rounded-3xl md-elevated-3 max-w-sm w-full p-6">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-lg font-bold text-on-surface">{title}</h3>
          <button onClick={onCancel} className="text-outline p-1 md-ripple rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="md-text-btn">{cancelLabel}</button>
          <button onClick={onConfirm} className="md-filled-btn">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-fade-in">
      <div className="w-20 h-20 rounded-full bg-surface-container-high flex items-center justify-center mb-4 text-outline">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-on-surface mb-1">{title}</h3>
      <p className="text-on-surface-variant text-sm max-w-xs">{desc}</p>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-bold text-on-surface px-1 mb-3">{children}</h2>;
}

export function formatDate(ts: number, lang: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const dateStr = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}
