import { useEffect, useRef, useState } from 'react'
import type { Assignee, Filter, FilterType, GanttTask, Tag } from '../types'
import { getListStatuses } from '../lib/clickup'

function readableFg(bg?: string): string | undefined {
  if (!bg) return undefined
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return '#000'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#000' : '#fff'
}

// ─── Metadata ────────────────────────────────────────────────────────────────

const FILTER_TYPES: { type: FilterType; label: string; icon: string }[] = [
  { type: 'status',      label: 'Status',        icon: '●' },
  { type: 'tag',         label: 'Tag',           icon: '#' },
  { type: 'assignee',    label: 'Assignee',      icon: '@' },
  { type: 'priority',    label: 'Priority',      icon: '!' },
  { type: 'name',        label: 'Name contains', icon: '⌕' },
  { type: 'due',         label: 'Due date',      icon: '⤓' },
  { type: 'start',       label: 'Start date',    icon: '⤒' },
  { type: 'deps',        label: 'Dependencies',  icon: '⇢' },
  { type: 'unscheduled', label: 'Unscheduled',   icon: '◌' },
  { type: 'overdue',     label: 'Overdue',       icon: '⧖' },
]

const DEFAULT_OP: Record<FilterType, string> = {
  status:      'is',
  tag:         'has',
  assignee:    'is',
  priority:    'is',
  name:        'contains',
  due:         'before',
  start:       'after',
  deps:        'has',
  unscheduled: 'is',
  overdue:     'is',
}

function newFilter(type: FilterType): Filter {
  const id = 'f' + Math.random().toString(36).slice(2, 8)
  const op = DEFAULT_OP[type]
  let value: unknown
  switch (type) {
    case 'status':
    case 'tag':
    case 'assignee':
    case 'priority':    value = []; break
    case 'name':        value = ''; break
    case 'due':
    case 'start':       value = null; break
    case 'deps':
    case 'unscheduled':
    case 'overdue':     value = null; break
  }
  return { id, type, op, value }
}

// ─── Data helpers (derived from allTasks) ────────────────────────────────────

function uniqueStatuses(tasks: GanttTask[]): { name: string; color?: string }[] {
  const map = new Map<string, string | undefined>()
  for (const t of tasks) if (t.status) map.set(t.status, t.statusColor)
  return [...map.entries()].map(([name, color]) => ({ name, color }))
}

function uniqueTags(tasks: GanttTask[]): Tag[] {
  const map = new Map<string, Tag>()
  for (const t of tasks) for (const tag of t.tags ?? []) if (!map.has(tag.name)) map.set(tag.name, tag)
  return [...map.values()]
}

function uniqueAssignees(tasks: GanttTask[]): Assignee[] {
  const map = new Map<number, Assignee>()
  for (const t of tasks) for (const a of t.assignees ?? []) if (!map.has(a.id)) map.set(a.id, a)
  return [...map.values()]
}

const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#ef4444' },
  2: { label: 'High',   color: '#f59e0b' },
  3: { label: 'Normal', color: '#64748b' },
  4: { label: 'Low',    color: '#94a3b8' },
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

// ─── useOutsideClose ─────────────────────────────────────────────────────────

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  return ref
}

// ─── OpSwitcher ──────────────────────────────────────────────────────────────

function OpSwitcher({ type, op, onChange }: { type: FilterType; op: string; onChange: (op: string) => void }) {
  let opts: [string, string][]
  if (type === 'status' || type === 'assignee' || type === 'priority')
    opts = [['is', 'is'], ['isNot', 'is not']]
  else if (type === 'tag' || type === 'deps')
    opts = [['has', 'has'], ['none', 'has no']]
  else if (type === 'name')
    opts = [['contains', 'contains'], ['notContains', 'excludes']]
  else if (type === 'due' || type === 'start')
    opts = [['before', 'before'], ['after', 'after']]
  else
    return null
  return (
    <div className="fbar-op-seg">
      {opts.map(([k, label]) => (
        <button key={k} className={'fbar-op-seg__btn' + (op === k ? ' is-on' : '')}
          onClick={() => onChange(k)} type="button">
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── MultiSelectList ─────────────────────────────────────────────────────────

function MultiSelectList<K>({
  items, value, onChange, renderItem,
}: {
  items: { key: K }[]
  value: K[]
  onChange: (next: K[]) => void
  renderItem: (item: { key: K }) => React.ReactNode
}) {
  const set = new Set(value)
  function toggle(v: K) {
    const next = new Set(set)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange([...next])
  }
  return (
    <div className="fbar-list">
      {items.map(it => {
        const on = set.has(it.key)
        return (
          <button key={String(it.key)}
            className={'fbar-list__item' + (on ? ' is-on' : '')}
            onClick={() => toggle(it.key)} type="button">
            <span className="fbar-list__check" aria-hidden="true">{on ? '✓' : ''}</span>
            {renderItem(it)}
          </button>
        )
      })}
    </div>
  )
}

// ─── Value editors ───────────────────────────────────────────────────────────

// The board's ClickUp list, for its status colors
export interface StatusSource {
  token: string
  listId: string
}

function StatusValueEditor({ value, onChange, allTasks, statusSource }: {
  value: string[]
  onChange: (v: string[]) => void
  allTasks: GanttTask[]
  statusSource?: StatusSource
}) {
  const statuses = uniqueStatuses(allTasks)
  const [fetchedColors, setFetchedColors] = useState<Map<string, string>>(new Map())
  const token = statusSource?.token
  const listId = statusSource?.listId

  useEffect(() => {
    if (!token || !listId) return
    getListStatuses(token, listId)
      .then(ss => setFetchedColors(new Map(ss.map(s => [s.status, s.color]))))
      .catch(() => {})
  }, [token, listId])

  const colorMap = new Map(statuses.map(s => [s.name, fetchedColors.get(s.name) ?? s.color]))

  return (
    <MultiSelectList
      items={statuses.map(s => ({ key: s.name }))}
      value={value}
      onChange={onChange}
      renderItem={({ key }) => (
        <span className="fbar-status">
          <span className="fbar-dot" style={{ background: colorMap.get(key) ?? '#888' }} />
          {key}
        </span>
      )}
    />
  )
}

function TagValueEditor({ value, onChange, allTasks }: { value: string[]; onChange: (v: string[]) => void; allTasks: GanttTask[] }) {
  const tags = uniqueTags(allTasks)
  return (
    <MultiSelectList
      items={tags.map(t => ({ key: t.name, t }))}
      value={value}
      onChange={onChange}
      renderItem={({ key }) => {
        const t = tags.find(x => x.name === key)
        return (
          <span className="fbar-tag-pill" style={{ background: t?.tag_bg, color: readableFg(t?.tag_bg) }}>
            {key}
          </span>
        )
      }}
    />
  )
}

function AssigneeValueEditor({ value, onChange, allTasks }: { value: number[]; onChange: (v: number[]) => void; allTasks: GanttTask[] }) {
  const [q, setQ] = useState('')
  const members = uniqueAssignees(allTasks)
  const filtered = members.filter(m => !q.trim() || m.username.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <input className="fbar-search" placeholder="Search people…" value={q}
        onChange={e => setQ(e.target.value)} autoFocus />
      <MultiSelectList
        items={filtered.map(m => ({ key: m.id, m }))}
        value={value}
        onChange={onChange}
        renderItem={({ key }) => {
          const m = members.find(x => x.id === key)
          return (
            <span className="fbar-person">
              <span className="fbar-avatar" title={m?.username}>{m ? avatarInitials(m.username) : '?'}</span>
              <span>{m?.username}</span>
            </span>
          )
        }}
      />
    </>
  )
}

function PriorityValueEditor({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const priorities = [1, 2, 3, 4] as const
  return (
    <MultiSelectList
      items={priorities.map(p => ({ key: p }))}
      value={value}
      onChange={onChange}
      renderItem={({ key }) => {
        const meta = PRIORITY_META[key]
        return (
          <span className="fbar-status">
            <span className="fbar-flag" style={{ color: meta.color }}>⚑</span>
            {meta.label}
          </span>
        )
      }}
    />
  )
}

function NameValueEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input className="fbar-search fbar-search--solo" placeholder="Match in task name…"
      value={value ?? ''} onChange={e => onChange(e.target.value)} autoFocus />
  )
}

function DateValueEditor({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const v = value ? new Date(value).toISOString().slice(0, 10) : ''
  return (
    <input type="date" className="fbar-date" value={v}
      onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
  )
}

// ─── Chip summary helpers ─────────────────────────────────────────────────────

function ChipSummary({ f, allTasks }: { f: Filter; allTasks: GanttTask[] }) {
  const tasks = allTasks

  switch (f.type) {
    case 'status': {
      const v = f.value as string[]
      if (!v.length) return <em>any status</em>
      if (v.length === 1) return <span>{v[0]}</span>
      return <span>{v.length} statuses</span>
    }
    case 'tag': {
      const v = f.value as string[]
      if (!v.length) return <em>any tag</em>
      const tags = uniqueTags(tasks)
      if (v.length <= 2) return (
        <>
          {v.map(n => {
            const t = tags.find(x => x.name === n)
            return <span key={n} className="fbar-tag-pill fbar-tag-pill--xs"
              style={{ background: t?.tag_bg, color: readableFg(t?.tag_bg) }}>{n}</span>
          })}
        </>
      )
      return <span>{v.length} tags</span>
    }
    case 'assignee': {
      const v = f.value as number[]
      if (!v.length) return <em>anyone</em>
      const members = uniqueAssignees(tasks)
      if (v.length <= 3) return (
        <span className="fbar-av-stack">
          {v.map(id => {
            const m = members.find(x => x.id === id)
            return m ? <span key={id} className="fbar-avatar fbar-avatar--xs"
              title={m.username}>{avatarInitials(m.username)}</span> : null
          })}
        </span>
      )
      return <span>{v.length} people</span>
    }
    case 'priority': {
      const v = f.value as number[]
      if (!v.length) return <em>any priority</em>
      if (v.length === 1) {
        const meta = PRIORITY_META[v[0]]
        return <><span className="fbar-flag" style={{ color: meta?.color }}>⚑</span>{meta?.label}</>
      }
      return <span>{v.length} levels</span>
    }
    case 'name':
      return (f.value as string) ? <span>"{f.value as string}"</span> : <em>any text</em>
    case 'due':
    case 'start': {
      if (!f.value) return <em>pick a date…</em>
      const dt = new Date(f.value as string)
      return <span>{dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
    }
    case 'deps':
    case 'unscheduled':
    case 'overdue':
      return null
  }
}

function chipOpLabel(f: Filter): string | null {
  if (f.type === 'unscheduled' || f.type === 'overdue') return null
  const m: Record<string, string> = {
    is: 'is', isNot: 'is not',
    has: 'has', none: 'has no',
    contains: 'contains', notContains: 'excludes',
    before: 'before', after: 'after',
    lt: '<', gt: '>', eq: '=',
  }
  return m[f.op] ?? null
}

function chipTypeLabel(f: Filter): string {
  return FILTER_TYPES.find(x => x.type === f.type)?.label ?? f.type
}

// ─── FilterChip ──────────────────────────────────────────────────────────────

function FilterChip({ filter, allTasks, statusSource, onChange, onRemove }: {
  filter: Filter
  allTasks: GanttTask[]
  statusSource?: StatusSource
  onChange: (f: Filter) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))

  function setField<K extends keyof Filter>(k: K, v: Filter[K]) {
    onChange({ ...filter, [k]: v })
  }

  const opLabel = chipOpLabel(filter)

  const editorMap: Partial<Record<FilterType, React.ReactNode>> = {
    status:   <StatusValueEditor   value={filter.value as string[]}        onChange={v => setField('value', v)} allTasks={allTasks} statusSource={statusSource} />,
    tag:      <TagValueEditor      value={filter.value as string[]}        onChange={v => setField('value', v)} allTasks={allTasks} />,
    assignee: <AssigneeValueEditor value={filter.value as number[]}        onChange={v => setField('value', v)} allTasks={allTasks} />,
    priority: <PriorityValueEditor value={filter.value as number[]}        onChange={v => setField('value', v)} />,
    name:     <NameValueEditor     value={filter.value as string}          onChange={v => setField('value', v)} />,
    due:      <DateValueEditor     value={filter.value as string | null}   onChange={v => setField('value', v)} />,
    start:    <DateValueEditor     value={filter.value as string | null}   onChange={v => setField('value', v)} />,
  }

  const editor = editorMap[filter.type]

  return (
    <span className="fbar-chip" ref={ref}>
      <button className="fbar-chip__main" onClick={() => setOpen(o => !o)} type="button">
        <span className="fbar-chip__type">{chipTypeLabel(filter)}</span>
        {opLabel && <span className="fbar-chip__op">{opLabel}</span>}
        <span className="fbar-chip__val">
          <ChipSummary f={filter} allTasks={allTasks} />
        </span>
        <span className="fbar-chip__chev" aria-hidden="true">▾</span>
      </button>
      <button className="fbar-chip__x" onClick={onRemove} type="button" aria-label="Remove filter">✕</button>
      {open && editor && (
        <div className="fbar-pop">
          <div className="fbar-pop__head">
            <span className="fbar-pop__title">{chipTypeLabel(filter)}</span>
            <OpSwitcher type={filter.type} op={filter.op} onChange={v => setField('op', v)} />
          </div>
          <div className="fbar-pop__body">{editor}</div>
        </div>
      )}
    </span>
  )
}

// ─── AddFilterButton ─────────────────────────────────────────────────────────

function AddFilterButton({ onAdd, compact }: { onAdd: (f: Filter) => void; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  return (
    <span className="fbar-add" ref={ref}>
      <button
        className={'fbar-add__btn' + (compact ? ' is-compact' : '')}
        onClick={() => setOpen(o => !o)} type="button">
        <span aria-hidden="true">+</span>{compact ? '' : ' Add filter'}
      </button>
      {open && (
        <div className="fbar-pop fbar-pop--menu">
          <div className="fbar-pop__head">
            <span className="fbar-pop__title">Filter by…</span>
          </div>
          <div className="fbar-menu">
            {FILTER_TYPES.map(t => (
              <button key={t.type} className="fbar-menu__item" type="button"
                onClick={() => { onAdd(newFilter(t.type)); setOpen(false) }}>
                <span className="fbar-menu__icon" aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}

// ─── FilterBar (exported) ────────────────────────────────────────────────────

interface FilterBarProps {
  allTasks: GanttTask[]
  filters: Filter[]
  setFilters: (filters: Filter[]) => void
  matchMode: 'all' | 'any'
  setMatchMode: (mode: 'all' | 'any') => void
  visibleCount: number
  statusSource?: StatusSource
}

export function FilterBar({ allTasks, filters, setFilters, matchMode, setMatchMode, visibleCount, statusSource }: FilterBarProps) {
  function update(id: string, next: Filter) { setFilters(filters.map(f => f.id === id ? next : f)) }
  function remove(id: string)               { setFilters(filters.filter(f => f.id !== id)) }
  function add(f: Filter)                   { setFilters([...filters, f]) }
  function clear()                          { setFilters([]) }

  const empty = filters.length === 0

  return (
    <div className="fbar">
      <div className="fbar__row">
        <div className="fbar__leading">
          <span className="fbar__icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M2 4h12M4.5 8h7M7 12h3" />
            </svg>
          </span>
          <span className="fbar__label">Filter</span>
        </div>

        <div className="fbar__chips">
          {filters.map(f => (
            <FilterChip key={f.id} filter={f} allTasks={allTasks} statusSource={statusSource}
              onChange={n => update(f.id, n)} onRemove={() => remove(f.id)} />
          ))}
          {filters.length >= 2 && (
            <span className="fbar__match">
              <button className={'fbar__match-btn' + (matchMode === 'all' ? ' is-on' : '')}
                onClick={() => setMatchMode('all')} type="button">All</button>
              <button className={'fbar__match-btn' + (matchMode === 'any' ? ' is-on' : '')}
                onClick={() => setMatchMode('any')} type="button">Any</button>
            </span>
          )}
          <AddFilterButton onAdd={add} compact={!empty} />
        </div>

        <div className="fbar__trailing">
          {!empty && (
            <>
              <span className="fbar__count">{visibleCount}/{allTasks.length}</span>
              <button className="fbar__clear" onClick={clear} type="button" title="Clear all filters">Clear</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
