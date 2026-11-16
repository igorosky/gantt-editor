import { useEffect, useMemo, useRef, useState } from 'react'
import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { fuzzyFilter, highlightRuns } from '../lib/fuzzy'
import { ancestors, buildTree } from '../lib/tree'
import { fmtShort } from '../lib/dates'

// Why a task is not on screen right now (a jump fixes the first two)
export type FindState = 'shown' | 'collapsed' | 'filtered' | 'backlog'

const STATE_NOTE: Record<Exclude<FindState, 'shown'>, string> = {
  collapsed: 'in a collapsed task',
  filtered: 'filtered out',
  backlog: 'backlog (hidden)',
}

interface Props {
  tasks: GanttTask[]
  stateOf: (id: string) => FindState
  onPick: (id: string) => void
  onClose: () => void
}

const LIMIT = 50

// Ctrl+K: jump to any task by a few letters of its name
export function QuickFind({ tasks, stateOf, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.qf-item--active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const tree = useMemo(() => buildTree(tasks), [tasks])
  const results = useMemo(() => fuzzyFilter(tasks, query, t => t.name, LIMIT), [tasks, query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) onPick(r.item.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="qf-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="qf" role="dialog" aria-modal="true" aria-label="Find a task" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="qf__input"
          placeholder="Find a task…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls="qf-list"
          aria-activedescendant={results[active] ? `qf-${results[active].item.id}` : undefined}
        />
        <div ref={listRef} id="qf-list" className="qf__list" role="listbox" aria-label="Tasks">
          {results.length === 0 && <div className="qf__empty">No tasks match</div>}
          {results.map(({ item: t, match }, i) => {
            const state = stateOf(t.id)
            const path = ancestors(t.id, tree).reverse().map(id => tree.byId.get(id)?.name ?? '').join(' › ')
            const dates = isMilestone(t)
              ? (t.end ? fmtShort(t.end) : '')
              : t.start && t.end ? `${fmtShort(t.start)} - ${fmtShort(t.end)}` : 'no dates'
            return (
              <button
                key={t.id}
                id={`qf-${t.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`qf-item${i === active ? ' qf-item--active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => onPick(t.id)}
              >
                <span className="qf-item__dot" style={{ background: t.statusColor ?? 'var(--border-strong)' }} aria-hidden="true" />
                <span className="qf-item__main">
                  <span className="qf-item__name">
                    {isMilestone(t) && <span className="tsp-item__ms" aria-hidden="true">◆ </span>}
                    {highlightRuns(t.name, match.indices).map((r, k) => (r.hit ? <mark key={k}>{r.text}</mark> : <span key={k}>{r.text}</span>))}
                  </span>
                  {path && <span className="qf-item__path">{path}</span>}
                </span>
                {state !== 'shown' && <span className="qf-item__state">{STATE_NOTE[state]}</span>}
                <span className="qf-item__dates">{dates}</span>
              </button>
            )
          })}
        </div>
        <div className="qf__foot">↑↓ to move · Enter to jump · Esc to close</div>
      </div>
    </div>
  )
}
