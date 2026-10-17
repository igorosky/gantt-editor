import { useEffect, useState } from 'react'
import type { ResolutionUse, SyncLogEntry, SyncReport } from '../types'
import { countsText, groupEntries, KIND_LABEL, runFailed } from '../lib/syncLog'

interface EntryListProps {
  entries: SyncLogEntry[]
  // Opens a task that is still on the board
  onOpenTask?: (id: string) => void
  taskIds?: Set<string>
}

const Value = ({ v }: { v: string }) =>
  v ? <span className="sync-val">{v}</span> : <span className="sync-val sync-val--empty">none</span>

const HOW_LABEL: Record<ResolutionUse, string> = {
  board: 'board',
  clickup: 'ClickUp',
  merge: 'merged',
  edit: 'edited',
}

export function SyncEntryList({ entries, onOpenTask, taskIds }: EntryListProps) {
  return (
    <div className="sync-groups">
      {groupEntries(entries).map(([kind, list]) => (
        <section key={kind} className={`sync-group sync-group--${kind}`}>
          <h4 className="sync-group__title">
            {KIND_LABEL[kind]} <span className="sync-group__count">{list.length}</span>
          </h4>
          <ul className="sync-entries">
            {list.map((e, i) => {
              const canOpen = !!onOpenTask && !!e.taskId && !!taskIds?.has(e.taskId)
              return (
                <li key={i} className="sync-entry">
                  <div className="sync-entry__head">
                    {e.task !== undefined && (canOpen ? (
                      <button type="button" className="sync-entry__task sync-entry__task--link" onClick={() => onOpenTask!(e.taskId!)}>
                        {e.task}
                      </button>
                    ) : (
                      <span className="sync-entry__task">{e.task}</span>
                    ))}
                    {e.detail && <span className="sync-entry__detail">{e.detail}</span>}
                  </div>
                  {e.changes && e.changes.length > 0 && (
                    <table className="sync-changes">
                      <tbody>
                        {e.changes.map((c, j) => (
                          <tr key={j}>
                            <th>{c.field}</th>
                            <td><Value v={c.from} /></td>
                            <td className="sync-changes__arrow">→</td>
                            <td><Value v={c.to} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {e.resolved && e.resolved.length > 0 && (
                    <table className="sync-changes sync-changes--resolved">
                      <thead>
                        <tr>
                          <th />
                          <th>Board</th>
                          <th>ClickUp</th>
                          <th />
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.resolved.map((c, j) => (
                          <tr key={j}>
                            <th>{c.field}</th>
                            <td><Value v={c.board} /></td>
                            <td><Value v={c.clickup} /></td>
                            <td className="sync-changes__arrow">→</td>
                            <td>
                              <Value v={c.result} />
                              <span className={`sync-how sync-how--${c.how}`}>{HOW_LABEL[c.how]}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

interface Props {
  runs: SyncReport[]
  onClose: () => void
  onClear: () => void
  onOpenTask: (id: string) => void
  taskIds: Set<string>
}

const fmtDuration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

export function SyncLogDialog({ runs, onClose, onClear, onOpenTask, taskIds }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(runs[0] ? [runs[0].id] : []))

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="sync-modal" role="dialog" aria-label="Sync log" onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h3 className="exp-title">Sync log</h3>
          {runs.length > 1 && <span className="sync-modal__hint">Last {runs.length} runs, newest first</span>}
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onClose} type="button" aria-label="Close">✕</button>
        </div>
        <div className="sync-modal__body">
          {runs.length === 0 && <div className="sync-empty">No pulls or pushes yet.</div>}
          {runs.map(run => {
            const isOpen = open.has(run.id)
            return (
              <div key={run.id} className={`sync-run${runFailed(run) ? ' sync-run--failed' : ''}`}>
                <button type="button" className="sync-run__head" aria-expanded={isOpen} onClick={() => toggle(run.id)}>
                  <span className="sync-run__caret">{isOpen ? '▾' : '▸'}</span>
                  <span className={`sync-run__dir sync-run__dir--${run.direction}`}>
                    {run.direction === 'pull' ? '↓ Pull' : '↑ Push'}
                  </span>
                  <span className="sync-run__when">{new Date(run.at).toLocaleString()}</span>
                  <span className="sync-run__counts">{run.aborted ? 'failed' : countsText(run)}</span>
                  <span className="sync-run__dur">{fmtDuration(run.durationMs)}</span>
                </button>
                {isOpen && (
                  <div className="sync-run__body">
                    {run.aborted && <div className="sync-aborted">{run.aborted}</div>}
                    {!run.aborted && run.entries.length === 0 && (
                      <div className="sync-empty">Board and ClickUp already matched.</div>
                    )}
                    <SyncEntryList entries={run.entries} onOpenTask={onOpenTask} taskIds={taskIds} />
                    {!!run.truncated && <div className="sync-empty">{run.truncated} more entries not kept.</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="sync-modal__foot">
          <button
            type="button"
            className="sync-btn"
            disabled={runs.length === 0}
            onClick={() => { if (confirm('Clear the sync log?')) onClear() }}
          >
            Clear log
          </button>
          <div className="exp-head-spacer" />
          <button type="button" className="sync-btn sync-btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
