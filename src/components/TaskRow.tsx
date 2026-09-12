import { useState, useRef, useEffect } from 'react'
import type { GanttTask } from '../types'
import { GANTT_ROW_HEIGHT } from '../constants'
import { isMilestone } from '../utils'
import { getTaskWarnings } from '../lib/warnings'
import { DatePicker } from './DatePicker'
import { TaskWarnings } from './TaskWarnings'

interface Props {
  task: GanttTask
  index: number
  onUpdate: (patch: Partial<GanttTask>) => void
  onRemove: () => void
  onOpenDetail: () => void
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
  isDragOver: boolean
  isCritical: boolean
}

export function TaskRow({ task, index, onUpdate, onRemove, onOpenDetail, onDragStart, onDragOver, onDrop, onDragEnd, isDragOver, isCritical }: Props) {
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

  return (
    <div
      className={`task-row${isDragOver ? ' task-row--drag-over' : ''}${ms ? ' task-row--milestone' : ''}${isCritical ? ' task-row--critical' : ''}`}
      style={{ height: GANTT_ROW_HEIGHT }}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
    >
      <span className="task-row__grip" aria-hidden="true">⠿</span>

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
              title="Milestone date"
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
              title="Due date"
              highlightEmpty
            />
          </>
        )}
      </div>

      <button
        className="task-row__detail-btn"
        onClick={onOpenDetail}
        aria-label={`Open details for ${task.name}`}
        title="Open details"
        type="button"
      >
        ⤢
      </button>
      <button
        className="task-row__delete"
        onClick={onRemove}
        aria-label={`Delete ${task.name}`}
        title="Delete task"
      >
        ✕
      </button>
    </div>
  )
}
