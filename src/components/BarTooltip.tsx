import { useLayoutEffect, useRef, useState } from 'react'
import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { daysBetween, fmtShort } from '../lib/dates'
import { daysLate, isDone } from '../lib/portfolio'
import { depIndex, violatedPredecessors } from '../lib/depGraph'
import { PRIORITY_LABELS } from '../lib/taskMenu'
import type { Settings } from '../lib/settings'
import { Avatar } from './Avatar'

interface Props {
  task: GanttTask
  allTasks: GanttTask[]
  x: number // pointer position (viewport)
  y: number
  settings: Settings
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// What a bar stands for, shown while the pointer rests on it
export function BarTooltip({ task, allTasks, x, y, settings }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x + 14, top: y + 18 })

  // Keep it on screen: flip left / up when it would overflow
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = x + 14 + r.width > window.innerWidth - 8 ? Math.max(8, x - 14 - r.width) : x + 14
    const top = y + 18 + r.height > window.innerHeight - 8 ? Math.max(8, y - 12 - r.height) : y + 18
    setPos({ left, top })
  }, [x, y, task.id])

  const ms = isMilestone(task)
  const idx = depIndex(allTasks)
  const preds = idx.preds.get(task.id)?.length ?? 0
  const succs = idx.succs.get(task.id)?.length ?? 0
  const subtasks = allTasks.filter(t => t.parentId === task.id)
  const late = daysLate(task, new Date())
  const blockedBy = settings.board.dependencyWarnings ? violatedPredecessors(allTasks, task.id) : []
  const prio = task.priority ? PRIORITY_LABELS[task.priority] : null
  const days = task.start && task.end ? daysBetween(task.start, task.end) + 1 : 0
  const showPictures = settings.board.avatars.tooltip

  return (
    <div ref={ref} className="bar-tip" role="tooltip" style={pos}>
      <div className="bar-tip__title">
        {ms && <span className="bar-tip__ms" aria-hidden="true">◆</span>}
        {task.name}
      </div>
      <div className="bar-tip__row">
        {ms
          ? <span>{task.end ? fmtShort(task.end) : 'No date'}</span>
          : (
            <span>
              {task.start ? fmtShort(task.start) : '?'} – {task.end ? fmtShort(task.end) : '?'}
              {days > 0 && <span className="bar-tip__muted"> · {plural(days, 'day')}</span>}
            </span>
          )}
        {task.status && (
          <span className="bar-tip__status" style={task.statusColor ? { background: task.statusColor } : undefined}>
            {task.status}
          </span>
        )}
      </div>
      {(prio || task.assignees?.length) && (
        <div className="bar-tip__row">
          {prio && <span style={{ color: prio.color }}>● {prio.label}</span>}
          {!!task.assignees?.length && (
            <span className="bar-tip__people">
              {task.assignees.map(a => (
                <span key={`${a.id}:${a.username}`} className="bar-tip__person">
                  {showPictures && <Avatar person={a} size={18} />}
                  {a.username}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {(preds > 0 || succs > 0 || subtasks.length > 0) && (
        <div className="bar-tip__row bar-tip__muted">
          {preds > 0 && <span>{plural(preds, 'predecessor')}</span>}
          {succs > 0 && <span>{plural(succs, 'successor')}</span>}
          {subtasks.length > 0 && <span>{subtasks.filter(isDone).length}/{subtasks.length} subtasks done</span>}
        </div>
      )}
      {late > 0 && <div className="bar-tip__warn">Overdue by {plural(late, 'day')}</div>}
      {blockedBy.length > 0 && (
        <div className="bar-tip__warn">
          Starts before {blockedBy.map(p => `"${p.name}"`).join(', ')} {blockedBy.length === 1 ? 'ends' : 'end'}
        </div>
      )}
    </div>
  )
}
