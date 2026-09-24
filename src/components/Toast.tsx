import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import IconX from '~icons/lucide/x'
import IconCircleAlert from '~icons/lucide/circle-alert'
import IconCircleCheck from '~icons/lucide/circle-check'
import IconLoader from '~icons/lucide/loader-circle'

export type ToastKind = 'info' | 'success' | 'error' | 'progress'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  detail?: string
  /** A button shown in the toast (e.g. "Undo"); clicking it dismisses the toast */
  action?: ToastAction
}

interface ToastApi {
  show: (
    kind: ToastKind,
    title: string,
    detail?: string,
    timeoutMs?: number,
    action?: ToastAction,
  ) => number
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>, timeoutMs?: number) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  const schedule = useCallback(
    (id: number, timeoutMs: number | undefined) => {
      const t = timers.current.get(id)
      if (t) clearTimeout(t)
      if (timeoutMs && timeoutMs > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), timeoutMs),
        )
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show: (kind, title, detail, timeoutMs, action) => {
        const id = ++seq.current
        setToasts((list) => [...list, { id, kind, title, detail, action }])
        schedule(id, timeoutMs ?? (kind === 'error' ? 12000 : kind === 'progress' ? 0 : 5000))
        return id
      },
      update: (id, patch, timeoutMs) => {
        setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
        schedule(id, timeoutMs ?? (patch.kind === 'error' ? 12000 : 5000))
      },
      dismiss,
    }),
    [dismiss, schedule],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-3 right-3 z-[95] flex flex-col gap-2 w-[380px] max-w-[92vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border shadow-xl px-3 py-2 flex gap-2 items-start bg-bg-3 ${
              t.kind === 'error'
                ? 'border-danger'
                : t.kind === 'success'
                  ? 'border-success'
                  : 'border-border-2'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {t.kind === 'error' && <IconCircleAlert className="text-danger" />}
              {t.kind === 'success' && <IconCircleCheck className="text-success" />}
              {t.kind === 'progress' && <IconLoader className="animate-spin text-fg-muted" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium break-words">{t.title}</div>
              {t.detail && (
                <pre className="mono text-xs text-fg-muted whitespace-pre-wrap break-words mt-1 max-h-40 overflow-y-auto">
                  {t.detail}
                </pre>
              )}
            </div>
            {t.action && (
              <button
                type="button"
                className="btn btn-secondary !py-0.5 shrink-0"
                onClick={() => {
                  dismiss(t.id)
                  t.action?.onClick()
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="icon-btn !w-5 !h-5"
              onClick={() => dismiss(t.id)}
              title="Dismiss"
            >
              <IconX className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
