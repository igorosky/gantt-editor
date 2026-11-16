import { useEffect, useMemo, useRef, useState } from 'react'
import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { fuzzyFilter, highlightRuns } from '../lib/fuzzy'
import { ancestors, buildTree } from '../lib/tree'
import { fmtShort } from '../lib/dates'

interface Props {
  tasks: GanttTask[] // candidates (every task on the board)
  refused: ReadonlyMap<string, string> // id -> why it cannot be picked (shown greyed)
  onPick: (id: string) => void
  onClose: () => void
  placeholder: string
  label: string
}

const LIMIT = 60

// Fuzzy task search with keyboard picking, for predecessors and successors.
// Matched letters are highlighted; each result shows its parents and dates.
export function TaskSearchPicker({ tasks, refused, onPick, onClose, placeholder, label }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCloseRef.current()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  const tree = useMemo(() => buildTree(tasks), [tasks])
  const pathOf = useMemo(() => {
    const out = new Map<string, string>()
    for (const t of tasks) {
      const names = ancestors(t.id, tree).reverse().map(id => tree.byId.get(id)?.name ?? '')
      if (names.length) out.set(t.id, names.join(' › '))
    }
    return out
  }, [tasks, tree])

  // Pickable ones first; refused ones stay visible, with the reason
  const results = useMemo(() => {
    const ranked = fuzzyFilter(tasks, query, t => t.name, Infinity)
    const ok = ranked.filter(r => !refused.has(r.item.id))
    const no = ranked.filter(r => refused.has(r.item.id))
    return [...ok, ...no].slice(0, LIMIT)
  }, [tasks, query, refused])
  const pickable = results.filter(r => !refused.has(r.item.id))

  useEffect(() => { setActive(0) }, [query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.tsp-item--active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(pickable.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const it = pickable[active]
      if (it) onPick(it.item.id)
    } else if (e.key === 'Escape') {
      // Only the picker closes, not the popup around it
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      onClose()
    }
  }

  const activeId = pickable[active]?.item.id

  return (
    <div
      ref={ref}
      className="tdp-picker tsp"
      role="dialog"
      aria-label={label}
      onClick={e => e.stopPropagation()}
      // On the root, so it also works with focus on a result
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        className="tdp-picker-search"
        placeholder={placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
        role="combobox"
        aria-expanded="true"
        aria-controls="tsp-list"
        aria-activedescendant={activeId ? `tsp-${activeId}` : undefined}
      />
      <div ref={listRef} id="tsp-list" className="tdp-picker-list" role="listbox" aria-label={label}>
        {results.length === 0 && <div className="tdp-picker-empty">No tasks</div>}
        {results.map(({ item: t, match }) => {
          const why = refused.get(t.id)
          const isActive = t.id === activeId
          const dates = isMilestone(t)
            ? (t.end ? fmtShort(t.end) : '')
            : t.start && t.end ? `${fmtShort(t.start)} - ${fmtShort(t.end)}` : ''
          return (
            <button
              key={t.id}
              id={`tsp-${t.id}`}
              type="button"
              role="option"
              aria-selected={isActive}
              aria-disabled={!!why}
              title={why}
              className={`tdp-picker-item tsp-item${isActive ? ' tsp-item--active' : ''}${why ? ' tsp-item--refused' : ''}`}
              onMouseEnter={() => { if (!why) setActive(pickable.findIndex(r => r.item.id === t.id)) }}
              // Keeps the focus (and the keyboard) in the search field
              onMouseDown={e => e.preventDefault()}
              onClick={() => { if (!why) onPick(t.id) }}
            >
              <span className="tsp-item__main">
                <span className="tdp-picker-name">
                  {isMilestone(t) && <span className="tsp-item__ms" aria-hidden="true">◆ </span>}
                  {highlightRuns(t.name, match.indices).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
                </span>
                {pathOf.get(t.id) && <span className="tsp-item__path">{pathOf.get(t.id)}</span>}
              </span>
              <span className="tsp-item__side">{why ?? dates}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
