import { useEffect, useRef, useState } from 'react'

interface Props {
  count: number // selected tasks
  alongCount: (days: number) => number // other tasks that move with them
  onShift: (days: number) => void
  onClose: () => void
}

// "Shift N tasks by D days": successors and subtasks follow, as in a drag
export function ShiftDatesDialog({ count, alongCount, onShift, onClose }: Props) {
  const [text, setText] = useState('7')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.select() }, [])
  const days = Number.parseInt(text, 10)
  const valid = Number.isFinite(days) && days !== 0 && Math.abs(days) <= 3650
  const along = valid ? alongCount(days) : 0

  const submit = () => { if (valid) onShift(days) }

  return (
    <div className="clickup-modal-overlay" onClick={onClose}>
      <div
        className="clickup-modal shift-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Shift dates"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          if (e.key === 'Enter') { e.preventDefault(); submit() }
        }}
      >
        <h2 className="clickup-modal__title">Shift dates</h2>
        <label className="shift-dialog__row">
          Move {count} task{count === 1 ? '' : 's'} by
          <span className="shift-dialog__stepper">
            <button type="button" aria-label="One day earlier" onClick={() => setText(String((valid ? days : 0) - 1))}>−</button>
            <input
              ref={inputRef}
              className="shift-dialog__input"
              inputMode="numeric"
              aria-label="Days"
              value={text}
              onChange={e => setText(e.target.value.replace(/[^\d-]/g, ''))}
            />
            <button type="button" aria-label="One day later" onClick={() => setText(String((valid ? days : 0) + 1))}>+</button>
          </span>
          days
        </label>
        <div className="clickup-modal__hint">
          {valid
            ? `${days > 0 ? 'Later' : 'Earlier'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}.${along ? ` ${along} successor${along === 1 ? '' : 's'} and subtask${along === 1 ? '' : 's'} move along.` : ''}`
            : 'Enter a number of days (negative = earlier).'}
        </div>
        <div className="clickup-modal__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="clickup-modal__save" disabled={!valid} onClick={submit}>
            Shift
          </button>
        </div>
      </div>
    </div>
  )
}
