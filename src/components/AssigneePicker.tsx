import { useEffect, useRef, useState } from 'react'
import type { Assignee } from '../types'
import { fuzzyFilter } from '../lib/fuzzy'
import { Avatar, type Person } from './Avatar'

interface Props {
  members: Person[]
  loading: boolean
  error: string | null
  assigned: Assignee[] // ticked
  partial?: ReadonlySet<number> // some of several tasks have them: a dash
  onToggle: (m: Person) => void
  onClose: () => void
}

export function AssigneePicker({ members, loading, error, assigned, partial, onToggle, onClose }: Props) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', fn), 0)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const filtered = fuzzyFilter(members, search, m => `${m.username} ${m.email ?? ''}`).map(r => r.item)
  const assignedIds = new Set(assigned.map(a => a.id))

  return (
    <div ref={ref} className="tdp-picker" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="tdp-picker-search"
        placeholder="Search people…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); onToggle(filtered[0]) }
        }}
      />
      <div className="tdp-picker-list">
        {loading && !members.length && <div className="tdp-picker-empty">Loading…</div>}
        {!loading && error && !members.length && <div className="tdp-picker-error">{error}</div>}
        {!(loading && !members.length) && !(error && !members.length) && filtered.length === 0 && <div className="tdp-picker-empty">No results</div>}
        {filtered.map(m => (
          <button
            key={m.id}
            type="button"
            className={`tdp-picker-item${assignedIds.has(m.id) ? ' is-assigned' : ''}`}
            onClick={() => onToggle(m)}
          >
            <Avatar person={m} size={22} title="" />
            <span className="tdp-picker-name">{m.username}</span>
            {assignedIds.has(m.id)
              ? <span className="tdp-picker-check">✓</span>
              : partial?.has(m.id) && <span className="tdp-picker-check tdp-picker-check--partial" title="Some of the tasks">-</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
