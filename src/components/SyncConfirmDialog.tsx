import { useEffect } from 'react'
import type { SyncDirection, SyncLogEntry } from '../types'
import { SyncEntryList } from './SyncLogDialog'

interface Props {
  direction: SyncDirection
  risks: SyncLogEntry[]
  onCancel: () => void
  onConfirm: () => void
}

const COPY: Record<SyncDirection, { title: string; text: string; go: string }> = {
  pull: {
    title: 'Pull will overwrite board changes',
    text: 'These board changes are not in ClickUp, and ClickUp has not changed these tasks since the last pull or push. Pulling replaces them with the ClickUp version.',
    go: 'Pull anyway',
  },
  push: {
    title: 'Push will overwrite ClickUp changes',
    text: 'These tasks were changed in ClickUp since the last pull or push. Pushing replaces them with the board version.',
    go: 'Push anyway',
  },
}

export function SyncConfirmDialog({ direction, risks, onCancel, onConfirm }: Props) {
  const copy = COPY[direction]

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onCancel])

  return (
    <div className="tdp-overlay" onClick={onCancel}>
      <div className="sync-modal sync-modal--confirm" role="alertdialog" aria-label={copy.title} onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h3 className="exp-title">{copy.title}</h3>
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onCancel} type="button" aria-label="Close">✕</button>
        </div>
        <div className="sync-modal__body">
          <p className="sync-confirm__text">{copy.text}</p>
          <SyncEntryList entries={risks} />
        </div>
        <div className="sync-modal__foot">
          <div className="exp-head-spacer" />
          <button type="button" className="sync-btn" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="sync-btn sync-btn--danger" onClick={onConfirm}>{copy.go}</button>
        </div>
      </div>
    </div>
  )
}
