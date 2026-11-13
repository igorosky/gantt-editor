import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { GanttTask } from '../types'
import { GANTT_ROW_HEIGHT } from '../constants'
import { isMilestone } from '../utils'
import { getTaskWarnings } from '../lib/warnings'
import { daysLate } from '../lib/portfolio'
import { statusBarStyle } from '../lib/color'
import type { Settings } from '../lib/settings'
import type { DropPosition, TreeRow } from '../lib/tree'
import type { ClickMods } from '../lib/selection'
import { modKey } from '../lib/keys'
import { DatePicker } from './DatePicker'
import { TaskWarnings } from './TaskWarnings'

// Horizontal step per hierarchy level, and where the indent starts (row
// padding + grip), for the drop indicator
const INDENT = 16
const INDENT_ORIGIN = 36

interface Props {
  row: TreeRow
  showToggles: boolean // some task has subtasks: reserve the toggle column
  onUpdate: (patch: Partial<GanttTask>) => void
  onOpenDetail: () => void
  onToggleCollapsed: () => void
  // Tab / Shift+Tab while renaming; absent when the move is not possible
  onIndent?: () => void
  onOutdent?: () => void
  // The task menu (shared with the bar's right-click) at a point
  onOpenMenu: (x: number, y: number, align: 'left' | 'right') => void
  menuOpen: boolean
  dimmed: boolean // outside a highlighted path
  lateAfter?: string[] // names of predecessors this task starts before (warning)
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  dropPos: DropPosition | null
  isCritical: boolean
  settings: Settings
  selected: boolean
  onSelect: (mods: ClickMods) => void
  renameSignal?: number // a new value starts renaming (F2, menu Rename)
}

export function TaskRow({
  row, showToggles, onUpdate, onOpenDetail, onToggleCollapsed,
  onIndent, onOutdent, onOpenMenu, menuOpen, dimmed, lateAfter,
  onDragStart, onDragOver, onDrop, onDragEnd, dropPos, isCritical, settings,
  selected, onSelect, renameSignal,
}: Props) {
  const { task, depth, childCount, doneChildren, collapsed, context } = row
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!editing) setDraft(task.name)
  }, [task.name, editing])

  useEffect(() => {
    if (renameSignal !== undefined) setEditing(true)
  }, [renameSignal])

  function commitName() {
    const trimmed = draft.trim() || task.name
    setDraft(trimmed)
    if (trimmed !== task.name) onUpdate({ name: trimmed })
    setEditing(false)
  }

  const ms = isMilestone(task)
  // Content warnings, plus a late start against predecessors (computed by
  // the board, outside the shared warning rules the portfolio uses)
  const warnings: Array<{ message: string }> = lateAfter?.length
    ? [...getTaskWarnings(task, settings), {
        message: `Starts before ${lateAfter.map(n => `"${n}"`).join(', ')} ${lateAfter.length === 1 ? 'ends' : 'end'}`,
      }]
    : getTaskWarnings(task, settings)
  const late = daysLate(task, new Date())
  const lateNote = late ? ` - overdue by ${late} day${late === 1 ? '' : 's'}` : ''
  const look = settings.board.statusColors ? statusBarStyle(task.statusColor) : null

  const dropIndent = INDENT_ORIGIN + (dropPos === 'inside-first' ? depth + 1 : depth) * INDENT
  const style = { height: GANTT_ROW_HEIGHT, '--drop-indent': `${dropIndent}px` } as CSSProperties

  return (
    <div
      className={`task-row${dropPos ? ` task-row--drop-${dropPos}` : ''}${ms ? ' task-row--milestone' : ''}${isCritical ? ' task-row--critical' : ''}${late ? ' task-row--overdue' : ''}${childCount ? ' task-row--parent' : ''}${context ? ' task-row--context' : ''}${selected ? ' task-row--selected' : ''}${dimmed ? ' task-row--dimmed' : ''}`}
      style={style}
      data-task-id={task.id}
      aria-selected={selected}
      onMouseDown={e => {
        // Shift+click selects a range, not text
        if (e.shiftKey && !(e.target as Element).closest('input, textarea')) e.preventDefault()
      }}
      onClick={e => {
        // Controls in the row do their own thing
        if ((e.target as Element).closest('button, input, textarea, select, a, .task-row__dates')) return
        onSelect({ shift: e.shiftKey, toggle: modKey(e) })
      }}
      onContextMenu={e => {
        // Text fields keep the browser's menu (copy / paste)
        if ((e.target as Element).closest('input, textarea')) return
        e.preventDefault()
        onOpenMenu(e.clientX, e.clientY, 'left')
      }}
      title={context ? 'Shown because a subtask matches the filters' : undefined}
      draggable={!editing}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDrop={e => { e.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
    >
      {look && (
        <span
          className="task-row__status"
          style={{ background: look.fill }}
          title={`Status: ${task.status ?? 'unknown'}`}
          aria-label={`Status: ${task.status ?? 'unknown'}`}
          role="img"
        />
      )}
      <span className="task-row__grip" aria-hidden="true">⠿</span>

      {depth > 0 && <span className="task-row__indent" style={{ width: depth * INDENT }} aria-hidden="true" />}
      {showToggles && (childCount > 0 ? (
        <button
          className="task-row__toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} subtasks of ${task.name}`}
          title={collapsed ? 'Show subtasks' : 'Hide subtasks'}
          type="button"
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="task-row__toggle task-row__toggle--leaf" aria-hidden="true" />
      ))}

      {ms && <span className="task-row__ms-glyph" title="Milestone" aria-hidden="true">◆</span>}

      <div className="task-row__name">
        {editing ? (
          <input
            ref={inputRef}
            className="task-row__name-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              // Handled here: the board's own Enter / Escape must not act too
              if (e.key === 'Enter') { e.preventDefault(); commitName() }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(task.name); setEditing(false) }
              if (e.key === 'Tab') {
                // Tab nests under the task above, Shift+Tab moves up a level
                e.preventDefault()
                commitName()
                if (e.shiftKey) onOutdent?.()
                else onIndent?.()
              }
            }}
          />
        ) : (
          <span
            className="task-row__name-text"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename (F2)"
          >
            {task.name}
          </span>
        )}
      </div>

      {/* How much a collapsed parent hides; expanded, the subtasks show themselves */}
      {collapsed && (
        <span
          className={`task-row__subcount${doneChildren === childCount ? ' task-row__subcount--done' : ''}`}
          title={`${doneChildren} of ${childCount} subtask${childCount === 1 ? '' : 's'} done`}
        >
          {doneChildren}/{childCount}
        </span>
      )}

      <TaskWarnings warnings={warnings} />

      <div className="task-row__dates">
        {ms ? (
          <>
            {/* Hidden stand-in for the start picker so the milestone date stays
                in the same column as every other row's due date */}
            <span className="task-row__date-ghost" aria-hidden="true">
              <DatePicker value={undefined} onChange={() => {}} title="" />
              <span className="task-row__date-sep">→</span>
            </span>
            <DatePicker
              value={task.end}
              onChange={d => onUpdate({ start: d, end: d })}
              title={`Milestone date${lateNote}`}
              highlightEmpty
            />
          </>
        ) : (
          <>
            <DatePicker
              value={task.start}
              onChange={d => onUpdate({ start: d, ...(task.end && d && d > task.end ? { end: d } : {}) })}
              title="Start date"
              highlightEmpty
            />
            <span className="task-row__date-sep">→</span>
            <DatePicker
              value={task.end}
              onChange={d => onUpdate({ end: d, ...(task.start && d && d < task.start ? { start: d } : {}) })}
              title={`Due date${lateNote}`}
              highlightEmpty
            />
          </>
        )}
      </div>

      <button
        className={`task-row__menu-btn${menuOpen ? ' task-row__menu-btn--open' : ''}`}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          onOpenMenu(r.right, r.bottom + 4, 'right')
        }}
        aria-label={`More actions for ${task.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More actions"
        type="button"
      >
        ⋯
      </button>
      <button
        className="task-row__detail-btn"
        onClick={onOpenDetail}
        aria-label={`Open details for ${task.name}`}
        title="Open details"
        type="button"
      >
        ⤢
      </button>
    </div>
  )
}
