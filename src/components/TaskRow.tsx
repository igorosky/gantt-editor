import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { GanttTask } from '../types'
import { GANTT_ROW_HEIGHT } from '../constants'
import { isMilestone } from '../utils'
import { getTaskWarnings } from '../lib/warnings'
import { daysLate } from '../lib/portfolio'
import type { DropPosition, TreeRow } from '../lib/tree'
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
  onRemove: () => void
  onOpenDetail: () => void
  onToggleCollapsed: () => void
  onAddSubtask: () => void
  // Absent when the move is not possible from here
  onIndent?: () => void
  onOutdent?: () => void
  onMakeTopLevel?: () => void
  topLevelBlocked?: string // why this subtask cannot become a top-level task
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  dropPos: DropPosition | null
  isCritical: boolean
}

interface MenuItem {
  label: string
  hint?: string
  onClick?: () => void
  title?: string
  danger?: boolean
}

// Fixed-position menu, so the scrolling task list never clips it
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setPos(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    // The menu is fixed, so it would drift off its row when the list scrolls
    const onScroll = () => setPos(null)
    const list = btnRef.current?.closest('.task-panel__list')
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    list?.addEventListener('scroll', onScroll)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      list?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [pos])

  function toggle() {
    if (pos) { setPos(null); return }
    const r = btnRef.current!.getBoundingClientRect()
    const up = r.bottom + 220 > window.innerHeight
    setPos({ x: r.right, y: up ? r.top - 4 : r.bottom + 4, up })
  }

  return (
    <>
      <button
        ref={btnRef}
        className={`task-row__menu-btn${pos ? ' task-row__menu-btn--open' : ''}`}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title="More actions"
        type="button"
      >
        ⋯
      </button>
      {pos && (
        <div
          ref={menuRef}
          className="row-menu"
          role="menu"
          style={{ left: pos.x, top: pos.y, transform: `translate(-100%, ${pos.up ? '-100%' : '0'})` }}
        >
          {items.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`row-menu__item${it.danger ? ' row-menu__item--danger' : ''}${it.onClick ? '' : ' row-menu__item--disabled'}`}
              // aria-disabled rather than disabled, so the title explaining why still shows
              aria-disabled={!it.onClick}
              title={it.title}
              onClick={() => {
                if (!it.onClick) return
                setPos(null)
                it.onClick()
              }}
            >
              <span>{it.label}</span>
              {it.hint && <span className="row-menu__hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export function TaskRow({
  row, showToggles, onUpdate, onRemove, onOpenDetail, onToggleCollapsed, onAddSubtask,
  onIndent, onOutdent, onMakeTopLevel, topLevelBlocked,
  onDragStart, onDragOver, onDrop, onDragEnd, dropPos, isCritical,
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

  function commitName() {
    const trimmed = draft.trim() || task.name
    setDraft(trimmed)
    onUpdate({ name: trimmed })
    setEditing(false)
  }

  const ms = isMilestone(task)
  const warnings = getTaskWarnings(task)
  const late = daysLate(task, new Date())
  const lateNote = late ? ` - overdue by ${late} day${late === 1 ? '' : 's'}` : ''

  const menu: MenuItem[] = [
    { label: 'Add subtask', onClick: onAddSubtask },
    { label: 'Make subtask of task above', hint: 'Tab', onClick: onIndent },
    {
      label: 'Move up a level', hint: 'Shift+Tab', onClick: onOutdent,
      title: !onOutdent && depth === 1 ? topLevelBlocked : undefined,
    },
    ...(depth >= 2
      ? [{ label: 'Make top-level task', onClick: onMakeTopLevel, title: onMakeTopLevel ? undefined : topLevelBlocked }]
      : []),
    { label: childCount ? 'Delete with subtasks' : 'Delete', onClick: onRemove, danger: true },
  ]

  const dropIndent = INDENT_ORIGIN + (dropPos === 'inside-first' ? depth + 1 : depth) * INDENT
  const style = { height: GANTT_ROW_HEIGHT, '--drop-indent': `${dropIndent}px` } as CSSProperties

  return (
    <div
      className={`task-row${dropPos ? ` task-row--drop-${dropPos}` : ''}${ms ? ' task-row--milestone' : ''}${isCritical ? ' task-row--critical' : ''}${late ? ' task-row--overdue' : ''}${childCount ? ' task-row--parent' : ''}${context ? ' task-row--context' : ''}`}
      style={style}
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
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { setDraft(task.name); setEditing(false) }
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
            onClick={() => setEditing(true)}
            title="Click to rename"
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

      <RowMenu label={`More actions for ${task.name}`} items={menu} />
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
