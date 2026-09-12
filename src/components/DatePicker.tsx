import { useState, useRef, useEffect } from 'react'

interface Props {
  value: Date | undefined
  onChange: (d: Date | undefined) => void
  title: string
  placeholder?: string
  highlightEmpty?: boolean
}

function toDateDisplay(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

function parseDateDisplay(s: string): Date | null {
  const [dd, mm, yyyy] = s.split('.')
  if (!dd || !mm || !yyyy) return null
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
  return isNaN(d.getTime()) ? null : d
}

export function DatePicker({ value, onChange, title, placeholder = 'DD.MM.YYYY', highlightEmpty = false }: Props) {
  const [draft, setDraft] = useState(() => value ? toDateDisplay(value) : '')
  const hiddenRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value ? toDateDisplay(value) : '') }, [value])

  function commit() {
    if (!draft.trim()) { onChange(undefined); return }
    const d = parseDateDisplay(draft)
    if (!d) { setDraft(value ? toDateDisplay(value) : ''); return }
    onChange(d)
  }

  const empty = !value
  const emptyClass = highlightEmpty && empty ? ' task-row__date-field--empty' : ''

  return (
    <div className={`task-row__date-field${emptyClass}`}>
      <input
        type="text"
        className="task-row__date-input"
        title={title}
        placeholder={placeholder}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
      />
      <button
        className="task-row__date-cal"
        tabIndex={-1}
        onMouseDown={e => { e.preventDefault(); hiddenRef.current?.showPicker() }}
        aria-label={`Open ${title} calendar`}
        type="button"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <rect x="0.65" y="1.65" width="10.7" height="9.7" rx="1.2"/>
          <line x1="0.65" y1="4.65" x2="11.35" y2="4.65"/>
          <line x1="3.5" y1="0.5" x2="3.5" y2="2.8"/>
          <line x1="8.5" y1="0.5" x2="8.5" y2="2.8"/>
        </svg>
      </button>
      <input
        ref={hiddenRef}
        type="date"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', bottom: 0, right: 0 }}
        onChange={e => {
          if (!e.target.value) return
          const [yyyy, mm, dd] = e.target.value.split('-')
          const display = `${dd}.${mm}.${yyyy}`
          setDraft(display)
          onChange(new Date(Number(yyyy), Number(mm) - 1, Number(dd)))
        }}
      />
    </div>
  )
}
