import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: ToastAction
}

export interface ToastOptions {
  kind?: Toast['kind']
  action?: ToastAction
  ms?: number
}

// Short-lived notices at the bottom of the board (undo / redo, refused
// links, bulk results). The newest three stay; each leaves after `ms`.
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id))
    const h = timers.current.get(id)
    if (h !== undefined) window.clearTimeout(h)
    timers.current.delete(id)
  }, [])

  const push = useCallback((text: string, opts: ToastOptions = {}) => {
    const id = ++nextId.current
    setToasts(ts => [...ts.slice(-2), { id, text, kind: opts.kind ?? 'info', action: opts.action }])
    timers.current.set(id, window.setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 6000 : 3500)))
    return id
  }, [dismiss])

  useEffect(() => {
    const all = timers.current
    return () => { for (const h of all.values()) window.clearTimeout(h) }
  }, [])

  return { toasts, push, dismiss }
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <span className="toast__text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => { t.action!.run(); onDismiss(t.id) }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
