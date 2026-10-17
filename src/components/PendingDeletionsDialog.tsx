import { useEffect } from 'react'
import type { PendingDeletion } from '../types'

interface Props {
  pending: PendingDeletion[]
  onRestore: (id: string) => void
  onRestoreAll: () => void
  onClose: () => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Linked tasks deleted on the board that ClickUp still has
export function PendingDeletionsDialog({ pending, onRestore, onRestoreAll, onClose }: Props) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="sync-modal sync-modal--delete" role="dialog" aria-label="Pending deletions" onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h3 className="exp-title">Pending deletions</h3>
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onClose} type="button" aria-label="Close">✕</button>
        </div>
        <div className="sync-modal__body">
          <p className="sync-confirm__text">
            Deleted on the board, still in ClickUp. Push asks whether to delete each one in ClickUp;
            Pull leaves them off the board. Restore puts a task back on the board as it was.
          </p>
          {pending.length === 0 && <div className="sync-empty">Nothing pending.</div>}
          <ul className="pending-list">
            {[...pending].reverse().map(d => {
              const subtasks = d.tasks.length - 1
              return (
                <li key={d.id} className="pending-list__row">
                  <div className="pending-list__main">
                    <span className="pending-list__name">{d.tasks[0]?.name}</span>
                    <span className="pending-list__meta">
                      {subtasks > 0 && `${plural(subtasks, 'subtask')} · `}
                      deleted {new Date(d.deletedAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sync-btn sync-btn--small"
                    aria-label={`Restore ${d.tasks[0]?.name}`}
                    onClick={() => onRestore(d.id)}
                  >
                    Restore
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="sync-modal__foot">
          <button type="button" className="sync-btn" disabled={pending.length < 2} onClick={onRestoreAll}>
            Restore all
          </button>
          <div className="exp-head-spacer" />
          <button type="button" className="sync-btn sync-btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
