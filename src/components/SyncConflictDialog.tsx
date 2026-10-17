import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ResolutionUse, SyncDirection } from '../types'
import { canEdit, canMerge, winner, type Resolution, type SyncConflict } from '../lib/conflicts'

interface Props {
  direction: SyncDirection
  conflicts: SyncConflict[]
  onCancel: () => void
  onApply: (picks: Map<string, Resolution>) => void
}

const COPY: Record<SyncDirection, { title: (n: number) => string; text: string; go: string }> = {
  pull: {
    title: n => `${n} conflict${n === 1 ? '' : 's'} before pulling`,
    text: 'Pulling would overwrite these board changes. Pick what to keep for each one. Pull writes nothing to ClickUp: values kept, merged or edited here stay on the board and go with the next Push.',
    go: 'Apply and pull',
  },
  push: {
    title: n => `${n} conflict${n === 1 ? '' : 's'} before pushing`,
    text: 'Pushing would overwrite these ClickUp changes. Pick what to keep for each one; the result is written to ClickUp and to the board.',
    go: 'Apply and push',
  },
}

const HOW_WORD: Record<ResolutionUse, string> = {
  board: 'from the board',
  clickup: 'from ClickUp',
  merge: 'merged',
  edit: 'edited',
}

function badge(c: SyncConflict, direction: SyncDirection): string {
  if (c.both) return 'Changed on both sides'
  return direction === 'pull' ? 'Changed on the board' : 'Changed in ClickUp'
}

const Val = ({ v }: { v: string }) =>
  v ? <span className="sync-conflict__val">{v}</span> : <span className="sync-conflict__val sync-val--empty">none</span>

export function SyncConflictDialog({ direction, conflicts, onCancel, onApply }: Props) {
  const copy = COPY[direction]
  const [choice, setChoice] = useState<Record<string, ResolutionUse>>(
    () => Object.fromEntries(conflicts.map(c => [c.id, winner(direction)])),
  )
  // Merge selections and edited texts survive switching back and forth
  const [mergeSel, setMergeSel] = useState<Record<string, string[]>>(
    () => Object.fromEntries(conflicts.filter(canMerge).map(c => [c.id, c.items!.merged])),
  )
  const [texts, setTexts] = useState<Record<string, string>>({})

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onCancel])

  const groups = useMemo(() => {
    const by = new Map<string, SyncConflict[]>()
    for (const c of conflicts) {
      const list = by.get(c.taskId)
      if (list) list.push(c)
      else by.set(c.taskId, [c])
    }
    return [...by.values()]
  }, [conflicts])

  const pick = (c: SyncConflict, use: ResolutionUse) => {
    if (use === 'edit' && texts[c.id] === undefined) {
      // Start from the side picked so far
      const from = choice[c.id] === 'clickup' ? c.text!.clickup : c.text!.board
      setTexts(prev => ({ ...prev, [c.id]: from }))
    }
    setChoice(prev => ({ ...prev, [c.id]: use }))
  }

  const pickAll = (use: 'board' | 'clickup') =>
    setChoice(Object.fromEntries(conflicts.map(c => [c.id, use])))

  const toggleItem = (id: string, key: string) => setMergeSel(prev => {
    const cur = prev[id] ?? []
    return { ...prev, [id]: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] }
  })

  const apply = () => {
    const picks = new Map<string, Resolution>()
    for (const c of conflicts) {
      const use = choice[c.id]
      if (use === 'merge') {
        // Keep the item order of the merge list
        const sel = new Set(mergeSel[c.id] ?? [])
        picks.set(c.id, { use, keys: c.items!.all.map(i => i.key).filter(k => sel.has(k)) })
      } else if (use === 'edit') {
        picks.set(c.id, { use, text: texts[c.id] ?? '' })
      } else {
        picks.set(c.id, { use })
      }
    }
    onApply(picks)
  }

  const counts = useMemo(() => {
    const n: Partial<Record<ResolutionUse, number>> = {}
    for (const c of conflicts) n[choice[c.id]] = (n[choice[c.id]] ?? 0) + 1
    return (['board', 'clickup', 'merge', 'edit'] as ResolutionUse[])
      .filter(k => n[k])
      .map(k => `${n[k]} ${HOW_WORD[k]}`)
      .join(' · ')
  }, [conflicts, choice])

  const emptyName = conflicts.some(c => c.key === 'name' && choice[c.id] === 'edit' && !(texts[c.id] ?? '').trim())

  return (
    <div className="tdp-overlay" onClick={onCancel}>
      <div
        className="sync-modal sync-modal--conflicts"
        role="dialog"
        aria-label={copy.title(conflicts.length)}
        onClick={e => e.stopPropagation()}
      >
        <div className="exp-head">
          <h3 className="exp-title">{copy.title(conflicts.length)}</h3>
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onCancel} type="button" aria-label="Close">✕</button>
        </div>
        <div className="sync-modal__body">
          <p className="sync-confirm__text">{copy.text}</p>
          <div className="sync-conflict__bulk">
            <span>Use for all:</span>
            <button type="button" className="sync-btn sync-btn--small" onClick={() => pickAll('board')}>Board</button>
            <button type="button" className="sync-btn sync-btn--small" onClick={() => pickAll('clickup')}>ClickUp</button>
          </div>
          {groups.map(list => (
            <section key={list[0].taskId} className="sync-conflict__task">
              <h4 className="sync-conflict__task-name">{list[0].task}</h4>
              {list.map(c => {
                const use = choice[c.id]
                const option = (u: ResolutionUse, title: string, value: ReactNode) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={use === u}
                    className={`sync-conflict__opt${use === u ? ' sync-conflict__opt--on' : ''}`}
                    onClick={() => pick(c, u)}
                  >
                    <span className="sync-conflict__opt-title">{title}</span>
                    {value}
                  </button>
                )
                const mergeLabels = canMerge(c)
                  ? c.items!.all.filter(i => (mergeSel[c.id] ?? []).includes(i.key)).map(i => i.label).join(', ')
                  : ''
                return (
                  <div key={c.id} className="sync-conflict">
                    <div className="sync-conflict__head">
                      <span className="sync-conflict__field">{c.label}</span>
                      <span className={`sync-conflict__badge${c.both ? ' sync-conflict__badge--both' : ''}`}>
                        {badge(c, direction)}
                      </span>
                    </div>
                    <div className="sync-conflict__opts" role="radiogroup" aria-label={`${c.task}: ${c.label}`}>
                      {option('board', 'Board', <Val v={c.text ? c.text.board : c.board} />)}
                      {option('clickup', 'ClickUp', <Val v={c.text ? c.text.clickup : c.clickup} />)}
                      {canMerge(c) && option('merge', 'Merge', <Val v={mergeLabels} />)}
                      {canEdit(c) && option('edit', 'Edit', <span className="sync-conflict__val sync-val--empty">write your own</span>)}
                    </div>
                    {use === 'merge' && canMerge(c) && (
                      <div className="sync-conflict__merge">
                        {c.items!.all.map(i => {
                          const on = (mergeSel[c.id] ?? []).includes(i.key)
                          const sides = [c.items!.board.includes(i.key) && 'board', c.items!.clickup.includes(i.key) && 'ClickUp']
                            .filter(Boolean).join(' + ')
                          return (
                            <label key={i.key} className={`sync-conflict__item${on ? ' sync-conflict__item--on' : ''}`} title={`On ${sides}`}>
                              <input type="checkbox" checked={on} onChange={() => toggleItem(c.id, i.key)} />
                              {i.color && <span className="tdp-tag-dot" style={{ background: i.color }} />}
                              {i.label}
                              <span className="sync-conflict__item-side">{sides}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                    {use === 'edit' && canEdit(c) && (
                      <div className="sync-conflict__edit">
                        {c.key === 'name' ? (
                          <input
                            className="sync-conflict__input"
                            value={texts[c.id] ?? ''}
                            onChange={e => setTexts(prev => ({ ...prev, [c.id]: e.target.value }))}
                            aria-label={`${c.task}: edited name`}
                            autoFocus
                          />
                        ) : (
                          <>
                            <textarea
                              className="sync-conflict__textarea"
                              value={texts[c.id] ?? ''}
                              onChange={e => setTexts(prev => ({ ...prev, [c.id]: e.target.value }))}
                              aria-label={`${c.task}: edited description`}
                              rows={6}
                              autoFocus
                            />
                            <div className="sync-conflict__edit-actions">
                              <span>Start from:</span>
                              <button type="button" className="sync-link" onClick={() => setTexts(prev => ({ ...prev, [c.id]: c.text!.board }))}>board</button>
                              <button type="button" className="sync-link" onClick={() => setTexts(prev => ({ ...prev, [c.id]: c.text!.clickup }))}>ClickUp</button>
                              <button
                                type="button"
                                className="sync-link"
                                onClick={() => setTexts(prev => ({ ...prev, [c.id]: [c.text!.board, c.text!.clickup].filter(Boolean).join('\n\n') }))}
                              >
                                both
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
        <div className="sync-modal__foot">
          <span className="sync-modal__hint">{counts}</span>
          <div className="exp-head-spacer" />
          <button type="button" className="sync-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="sync-btn sync-btn--primary"
            onClick={apply}
            disabled={emptyName}
            title={emptyName ? 'An edited name cannot be empty' : undefined}
          >
            {copy.go}
          </button>
        </div>
      </div>
    </div>
  )
}
