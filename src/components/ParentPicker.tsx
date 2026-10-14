import { useEffect, useMemo, useRef, useState } from 'react'
import type { GanttTask } from '../types'
import { buildTree, descendants, flattenTree } from '../lib/tree'

interface Props {
  tasks: GanttTask[] // every task on the board
  task: GanttTask // the task getting a new parent (may be an uncommitted draft)
  onPick: (parentId: string) => void
  onClose: () => void
}

// Searchable list of the tasks `task` can be moved under: anything but itself
// and its own subtasks, shown as the indented tree.
export function ParentPicker({ tasks, task, onPick, onClose }: Props) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const rows = useMemo(() => {
    const blocked = new Set([task.id, ...descendants(task.id, buildTree(tasks)).map(t => t.id)])
    return flattenTree(tasks).filter(r => !blocked.has(r.task.id))
  }, [tasks, task.id])

  const q = search.trim().toLowerCase()
  const shown = q ? rows.filter(r => r.task.name.toLowerCase().includes(q)) : rows

  return (
    <div ref={ref} className="tdp-picker tdp-parent-picker" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="tdp-picker-search"
        placeholder="Search tasks…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="tdp-picker-list">
        {shown.length === 0 && <div className="tdp-picker-empty">No tasks</div>}
        {shown.map(r => (
          <button
            key={r.task.id}
            type="button"
            className={`tdp-picker-item${r.task.id === task.parentId ? ' is-assigned' : ''}`}
            // Indent only in the full tree; search results are a flat list
            style={q ? undefined : { paddingLeft: 10 + r.depth * 14 }}
            onClick={() => onPick(r.task.id)}
          >
            <span className="tdp-picker-name">{r.task.type === 'milestone' ? '◆ ' : ''}{r.task.name}</span>
            {r.task.id === task.parentId && <span className="tdp-picker-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
