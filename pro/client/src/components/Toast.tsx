import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

type PushToast = (message: string, tone?: Tone) => void;

const ToastContext = createContext<PushToast>(() => undefined);

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (message, tone = "info") => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-4), { id, message, tone }]);
      window.setTimeout(() => remove(id), tone === "error" ? 6500 : 4000);
    },
    [remove],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-label="Notifications" aria-live="polite">
        {items.map((item) => {
          const Icon =
            item.tone === "success"
              ? CheckCircle2
              : item.tone === "error"
                ? AlertTriangle
                : Info;
          return (
            <div
              key={item.id}
              className={`toast toast-${item.tone}`}
              role={item.tone === "error" ? "alert" : "status"}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => remove(item.id)}
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
