import { useEffect, useState } from 'react'
import type { DeletionCandidate } from '../lib/deletions'

interface Props {
  candidates: DeletionCandidate[]
  onCancel: () => void
  // Pending deletion id -> delete in ClickUp
  onDone: (decisions: Map<string, boolean>) => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Asks about one task deleted on the board at a time, before the push writes
// anything. Cancel stops the whole push.
export function SyncDeleteDialog({ candidates, onCancel, onDone }: Props) {
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState<Map<string, boolean>>(() => new Map())

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onCancel])

  const c = candidates[index]
  const rest = candidates.length - index - 1

  // Decides the current task, or it and every one after it
  const decide = (remove: boolean, all = false) => {
    const next = new Map(decisions)
    for (const x of all ? candidates.slice(index) : [c]) next.set(x.id, remove)
    if (all || index === candidates.length - 1) {
      onDone(next)
      return
    }
    setDecisions(next)
    setIndex(index + 1)
  }

  if (!c) return null
  // The ClickUp tasks behind it, when that is more than the row named above
  const showList = c.tasks.length > 1 || c.tasks[0]?.name !== c.name
  const stillOnBoard = c.extra.filter(x => x.onBoard)
  const clickUpOnly = c.extra.filter(x => !x.onBoard)

  return (
    <div className="tdp-overlay" onClick={onCancel}>
      <div
        className="sync-modal sync-modal--delete"
        role="dialog"
        aria-label="Delete in ClickUp"
        onClick={e => e.stopPropagation()}
      >
        <div className="exp-head">
          <h3 className="exp-title">Delete in ClickUp?</h3>
          {candidates.length > 1 && <span className="sync-modal__hint">{index + 1} of {candidates.length}</span>}
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onCancel} type="button" aria-label="Close">✕</button>
        </div>
        <div className="sync-modal__body">
          <p className="sync-confirm__text">
            <strong className="sync-delete__name">{c.name}</strong> was deleted on the board
            on {new Date(c.deletedAt).toLocaleString()}, but ClickUp still has it.
          </p>
          {showList && (
            <div className="sync-delete__block">
              {plural(c.tasks.length, 'ClickUp task')} deleted on the board:
              <ul className="sync-delete__list">
                {c.tasks.map(t => <li key={t.cuid}>{t.name}</li>)}
              </ul>
            </div>
          )}
          {c.changedInClickUp && (
            <div className="sync-delete__block sync-delete__warn">Changed in ClickUp after it was deleted on the board.</div>
          )}
          {c.extra.length > 0 && (
            <div className="sync-delete__block sync-delete__warn">
              ClickUp deletes subtasks with their parent, so this also deletes:
              <ul className="sync-delete__list">
                {stillOnBoard.map(x => <li key={x.cuid}>{x.name} <span className="sync-delete__where">still on the board</span></li>)}
                {clickUpOnly.map(x => <li key={x.cuid}>{x.name} <span className="sync-delete__where">only in ClickUp</span></li>)}
              </ul>
            </div>
          )}
          <p className="sync-modal__hint">
            Keep in ClickUp forgets the deletion: the next Pull brings it back to the board.
          </p>
        </div>
        <div className="sync-modal__foot sync-modal__foot--stack">
          <div className="sync-delete__row">
            <button type="button" className="sync-btn" onClick={onCancel}>Cancel push</button>
            <div className="exp-head-spacer" />
            <button type="button" className="sync-btn" onClick={() => decide(false)}>Keep in ClickUp</button>
            <button type="button" className="sync-btn sync-btn--danger" onClick={() => decide(true)}>Delete in ClickUp</button>
          </div>
          {rest > 0 && (
            <div className="sync-delete__row">
              <div className="exp-head-spacer" />
              <button type="button" className="sync-btn" onClick={() => decide(false, true)}>
                Keep this and {rest} more
              </button>
              <button type="button" className="sync-btn sync-btn--danger-soft" onClick={() => decide(true, true)}>
                Delete this and {rest} more
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
