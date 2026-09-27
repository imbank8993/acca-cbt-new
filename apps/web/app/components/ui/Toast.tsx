"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (item: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
  // Convenience methods
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

// ─── Constants ────────────────────────────────────────────

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: { border: 'border-[#3083FF]/20 shadow-[#3083FF]/5', icon: 'text-[#3083FF]', title: 'text-[#3083FF]', msg: 'text-[#3083FF]/80', bar: 'bg-gradient-to-r from-[#3083FF] to-[#3083FF]' },
  error: { border: 'border-red-200', icon: 'text-red-500', title: 'text-red-800', msg: 'text-red-600', bar: 'bg-red-500' },
  warning: { border: 'border-amber-200', icon: 'text-amber-500', title: 'text-amber-800', msg: 'text-amber-600', bar: 'bg-amber-500' },
  info: { border: 'border-blue-200', icon: 'text-blue-500', title: 'text-blue-800', msg: 'text-blue-600', bar: 'bg-blue-500' },
};

// ─── Context ───────────────────────────────────────────────

const ToastContext = createContext<ToastContextType | null>(null);

// ─── ID Generator ─────────────────────────────────────────

let toastCounter = 0;
function generateId(): string {
  return `toast-${Date.now()}-${++toastCounter}`;
}

// ─── Provider ─────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = generateId();
    setItems(prev => [...prev, { ...item, id }]);
    const dur = item.duration ?? 5000;
    if (dur > 0) setTimeout(() => dismiss(id), dur);
  }, [dismiss]);

  const toast = useCallback((item: Omit<ToastItem, 'id'>) => {
    addToast(item);
  }, [addToast]);

  const success = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message, duration: 8000 });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    addToast({ type: 'warning', title, message, duration: 6000 });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toast, dismiss, success, error, warning, info }}>
      {children}

      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {items.map(item => {
            const Icon = ICONS[item.type];
            const c = COLORS[item.type];
            const dur = item.duration ?? 5000;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={`relative w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl shadow-lg border ${c.border} bg-white`}
              >
                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1">
                  <motion.div
                    className={`h-full ${c.bar}`}
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: dur / 1000, ease: 'linear' }}
                  />
                </div>

                {/* Content */}
                <div className="flex items-start gap-3 p-4">
                  <div className={`shrink-0 ${c.icon}`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm ${c.title}`}>{item.title}</p>
                    {item.message && (
                      <p className={`text-xs mt-0.5 ${c.msg}`}>{item.message}</p>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(item.id)}
                    className="shrink-0 p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

// ─── Export types for external use ────────────────────────

export type { ToastItem as Toast };