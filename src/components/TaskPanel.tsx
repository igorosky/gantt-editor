import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Filter, GanttTask } from '../types'
import { TaskRow } from './TaskRow'
import { FilterBar } from './FilterBar'
import { GANTT_HEADER_HEIGHT } from '../constants'
import {
  ancestors, canBecomeTopLevel, canOutdent, indentTarget, moveTarget, TOP_LEVEL_BLOCKED,
  type DropPosition, type Tree, type TreeRow,
} from '../lib/tree'
import type { Settings } from '../lib/settings'

interface Props {
  rows: TreeRow[]
  tree: Tree
  matchCount: number
  allTasks: GanttTask[]
  filters: Filter[]
  setFilters: (filters: Filter[]) => void
  matchMode: 'all' | 'any'
  setMatchMode: (mode: 'all' | 'any') => void
  onAdd: () => void
  onClear: () => void
  onSort: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<GanttTask>) => void
  onMove: (id: string, targetId: string, pos: DropPosition) => void
  onIndent: (id: string) => void
  onOutdent: (id: string) => void
  onMakeTopLevel: (id: string) => void
  onAddSubtask: (parentId: string) => void
  onToggleCollapsed: (id: string) => void
  onSetAllCollapsed: (collapsed: boolean) => void
  onOpenDetail: (id: string) => void
  listRef: RefObject<HTMLDivElement>
  criticalIds: Set<string>
  settings: Settings
}

export function TaskPanel({
  rows, tree, matchCount, allTasks, filters, setFilters, matchMode, setMatchMode,
  onAdd, onClear, onSort, onRemove, onUpdate, onMove, onIndent, onOutdent, onMakeTopLevel,
  onAddSubtask, onToggleCollapsed, onSetAllCollapsed, onOpenDetail, listRef, criticalIds, settings,
}: Props) {
  const dragIdRef = useRef<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; pos: DropPosition } | null>(null)

  const hasParents = tree.children.size > 0
  const anyExpanded = rows.some(r => r.childCount > 0 && !r.collapsed && !r.context)

  // Top quarter: before the row; bottom quarter: after it (into an expanded
  // parent, that is its first subtask); middle: make it a subtask.
  function dropPosition(e: React.DragEvent, row: TreeRow): DropPosition {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const rel = (e.clientY - rect.top) / rect.height
    if (rel < 0.25) return 'before'
    if (rel > 0.75) return row.childCount > 0 && !row.collapsed ? 'inside-first' : 'after'
    return 'inside'
  }

  function handleDragOver(e: React.DragEvent, row: TreeRow) {
    const id = dragIdRef.current
    if (!id) return
    const pos = dropPosition(e, row)
    if (!moveTarget(tree, id, row.task.id, pos)) {
      if (drop) setDrop(null)
      return // no preventDefault: the browser shows "not allowed"
    }
    e.preventDefault()
    if (drop?.id !== row.task.id || drop.pos !== pos) setDrop({ id: row.task.id, pos })
  }

  function handleDrop() {
    const id = dragIdRef.current
    if (id && drop) onMove(id, drop.id, drop.pos)
    dragIdRef.current = null
    setDrop(null)
  }

  function handleDragEnd() {
    dragIdRef.current = null
    setDrop(null)
  }

  return (
    <div className="task-panel">
      <div className="task-panel__header" style={{ height: GANTT_HEADER_HEIGHT }}>
        <h2 className="task-panel__title">Tasks</h2>
        <div className="task-panel__header-actions">
          {hasParents && (
            <button
              className="task-panel__clear-btn"
              onClick={() => onSetAllCollapsed(anyExpanded)}
              title={anyExpanded ? 'Hide every subtask' : 'Show every subtask'}
            >
              {anyExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          <button
            className="task-panel__sort-btn"
            onClick={onSort}
            disabled={allTasks.length < 2}
            title="Reorder by start date, then due date, priority and name. Subtasks are sorted under their parent. Replaces the current manual order."
          >
            ⇅ Sort
          </button>
          <button className="task-panel__clear-btn" onClick={onClear}>Clear all</button>
          <button className="task-panel__add-btn" onClick={onAdd}>+ Add task</button>
        </div>
      </div>

      <FilterBar
        allTasks={allTasks}
        filters={filters}
        setFilters={setFilters}
        matchMode={matchMode}
        setMatchMode={setMatchMode}
        visibleCount={matchCount}
      />

      <div className="task-panel__list" ref={listRef}>
        {rows.length === 0 && (
          <p className="task-panel__empty">
            {filters.length > 0 ? 'No tasks match your filters.'
              : allTasks.length > 0 ? 'Every task is in the backlog, which Settings hide from the board.'
              : 'No tasks yet. Add one above.'}
          </p>
        )}
        {rows.map(row => {
          const { task } = row
          const chain = ancestors(task.id, tree)
          const root = chain[chain.length - 1]
          return (
            <TaskRow
              key={task.id}
              row={row}
              showToggles={hasParents}
              onUpdate={patch => onUpdate(task.id, patch)}
              onRemove={() => onRemove(task.id)}
              onOpenDetail={() => onOpenDetail(task.id)}
              onToggleCollapsed={() => onToggleCollapsed(task.id)}
              onAddSubtask={() => onAddSubtask(task.id)}
              onIndent={indentTarget(tree, task.id) ? () => onIndent(task.id) : undefined}
              onOutdent={canOutdent(tree, task.id) ? () => onOutdent(task.id) : undefined}
              onMakeTopLevel={chain.length >= 2 && moveTarget(tree, task.id, root, 'after')
                ? () => onMakeTopLevel(task.id) : undefined}
              topLevelBlocked={chain.length > 0 && !canBecomeTopLevel(task) ? TOP_LEVEL_BLOCKED : undefined}
              onDragStart={() => { dragIdRef.current = task.id }}
              onDragOver={e => handleDragOver(e, row)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              dropPos={drop?.id === task.id ? drop.pos : null}
              isCritical={criticalIds.has(task.id)}
              settings={settings}
            />
          )
        })}
      </div>
    </div>
  )
}
