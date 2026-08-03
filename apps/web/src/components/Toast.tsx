import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

const ToastContext = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message && (
        <div className="toast-in fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 rounded-[10px] border border-zinc-600 bg-zinc-900 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          <Check size={16} className="text-green-500" />
          <span className="text-[13px] text-zinc-200">{message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
}
