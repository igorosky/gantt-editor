import React, { useEffect, useRef, useState } from 'react'
import FrappeGantt from 'frappe-gantt'
import type FrappeGanttNS from 'frappe-gantt'
import type { CriticalScope, GanttTask } from '../types'
import { getAllSuccessors, isMilestone } from '../utils'
import { edgeKey } from '../lib/criticalPath'
import { buildTree, descendants, dragClosure, subtreeSpan, type TreeRow } from '../lib/tree'
import { daysBetween, isoDay, shiftDays } from '../lib/dates'

// Column layout of the rendered chart, for widgets drawn in step with it
export interface GanttGeometry {
  dates: Date[] // start of every column
  columnWidth: number
}

// Whether the task gets a bar (a dateless one is a hidden placeholder row)
const hasBar = (t: GanttTask): boolean => (isMilestone(t) ? !!(t.end ?? t.start) : !!(t.start && t.end))

interface Props {
  tasks: GanttTask[] // the visible rows, in display order
  allTasks: GanttTask[] // every task: subtask spans and date propagation reach hidden rows too
  rows: TreeRow[] // display metadata for `tasks`
  onDateChange: (id: string, start: Date, end: Date) => void
  onContainerReady: (el: HTMLElement) => void
  onToggleDependency: (sourceId: string, targetId: string) => void
  focusIdRef?: React.MutableRefObject<string | null>
  criticalIds: Set<string>
  criticalEdges: Set<string>
  criticalOn: boolean
  onToggleCritical: () => void
  criticalScope: CriticalScope
  onCriticalScopeChange: (scope: CriticalScope) => void
  onGeometry?: (g: GanttGeometry | null) => void
  loadStripOn: boolean
  onToggleLoadStrip: () => void
}

export function GanttPanel({
  tasks,
  allTasks,
  rows,
  onDateChange,
  onContainerReady,
  onToggleDependency,
  focusIdRef,
  criticalIds,
  criticalEdges,
  criticalOn,
  onToggleCritical,
  criticalScope,
  onCriticalScopeChange,
  onGeometry,
  loadStripOn,
  onToggleLoadStrip,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<InstanceType<typeof FrappeGantt> | null>(null)

  // Always-current refs for callbacks set once at gantt init
  const onDateChangeRef = useRef(onDateChange)
  const onContainerReadyRef = useRef(onContainerReady)
  const onToggleDependencyRef = useRef(onToggleDependency)
  const onGeometryRef = useRef(onGeometry)
  const allTasksRef = useRef(allTasks)
  useEffect(() => {
    onDateChangeRef.current = onDateChange
    onContainerReadyRef.current = onContainerReady
    onToggleDependencyRef.current = onToggleDependency
    onGeometryRef.current = onGeometry
    allTasksRef.current = allTasks
  })

  // Reports the column layout whenever it changes. Called after init / refresh
  // and on scroll, since infinite padding re-renders with extra columns from
  // inside frappe-gantt's own wheel handler.
  const lastGeomRef = useRef('')
  function emitGeometry() {
    const gantt = ganttRef.current as any
    const dates = gantt?.dates as Date[] | undefined
    const columnWidth = gantt?.config?.column_width as number | undefined
    if (!dates?.length || !columnWidth) {
      if (lastGeomRef.current) { lastGeomRef.current = ''; onGeometryRef.current?.(null) }
      return
    }
    const sig = `${dates[0].getTime()}:${dates.length}:${columnWidth}`
    if (sig === lastGeomRef.current) return
    lastGeomRef.current = sig
    onGeometryRef.current?.({ dates: dates.slice(), columnWidth })
  }

  // The chart height is fixed at init; keep it matching the panel when the
  // window or the layout around it (e.g. the workload strip) changes size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const gantt = ganttRef.current as any
      const gc = gantt?.$container as HTMLElement | undefined
      const h = el.clientHeight
      if (!gc || h <= 0) return
      gc.style.height = `${h}px`
      gantt.options.container_height = h
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Connect-mode state (React) + refs (for use inside frappe-gantt callbacks)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<string | null>(null)
  const connectModeRef = useRef(false)
  const connectSourceRef = useRef<string | null>(null)

  // This ref is reassigned every render so the gantt on_click callback always
  // has access to up-to-date closures (connectModeRef etc. are refs so stale
  // values are not an issue, but onToggleDependencyRef is updated here too).
  const ganttClickRef = useRef<(task: FrappeGanttNS.Task) => void>(null!)
  ganttClickRef.current = (task: FrappeGanttNS.Task) => {
    if (!connectModeRef.current || !task.id) return
    const src = connectSourceRef.current

    if (!src) {
      // First click — mark as predecessor
      connectSourceRef.current = task.id
      setConnectSource(task.id)
      highlightBar(task.id, true)
    } else if (task.id === src) {
      // Clicked the same bar — cancel selection
      highlightBar(src, false)
      connectSourceRef.current = null
      setConnectSource(null)
    } else {
      // Second click — create / remove dependency, exit connect mode
      highlightBar(src, false)
      connectSourceRef.current = null
      connectModeRef.current = false
      setConnectMode(false)
      setConnectSource(null)
      onToggleDependencyRef.current(src, task.id)
    }
  }

  // Arrows carry no class of their own — frappe-gantt draws them as bare paths
  // tagged with data-from / data-to — and they are rebuilt on every refresh, so
  // the critical ones are re-marked after each render.
  function applyCriticalArrows() {
    containerRef.current
      ?.querySelectorAll<SVGPathElement>('path[data-from][data-to]')
      .forEach(p => {
        const key = edgeKey(p.getAttribute('data-from')!, p.getAttribute('data-to')!)
        p.classList.toggle('arrow--critical', criticalEdges.has(key))
      })
  }

  function highlightBar(taskId: string, on: boolean) {
    containerRef.current
      ?.querySelector(`[data-id="${taskId}"]`)
      ?.classList.toggle('bar--selected', on)
  }

  function toggleConnectMode() {
    if (connectModeRef.current) {
      // Exit
      if (connectSourceRef.current) highlightBar(connectSourceRef.current, false)
      connectSourceRef.current = null
      connectModeRef.current = false
      setConnectMode(false)
      setConnectSource(null)
    } else {
      connectModeRef.current = true
      setConnectMode(true)
    }
  }

  // Escape cancels connect mode
  useEffect(() => {
    if (!connectMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleConnectMode()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [connectMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!containerRef.current) return

    const tree = buildTree(allTasks)
    const meta = new Map(rows.map(r => [r.task.id, r]))
    // Only rows with a bar can carry arrows or move along in a drag; frappe's
    // drag code dereferences the bar of every predecessor it is given.
    const barIds = new Set(tasks.filter(hasBar).map(t => t.id))

    const frappeTasks = tasks.map(t => {
      if (!hasBar(t)) return { id: t.id, name: t.name, _placeholder: true, progress: 0, dependencies: '' }
      const deps = (t.dependencies ?? []).filter(d => barIds.has(d)).join(',')
      const row = meta.get(t.id)
      const isParent = !!row?.childCount
      // custom_class is a space-joined token list, read by the fork's Bar.refresh
      const classes = [
        isMilestone(t) ? 'milestone' : '',
        isParent ? 'parent' : '',
        row?.context ? 'context' : '',
        criticalIds.has(t.id) ? 'critical' : '',
      ].filter(Boolean).join(' ')
      // Subtasks (with bars) move along when the parent is dragged
      const dragWith = isParent ? descendants(t.id, tree).map(d => d.id).filter(id => barIds.has(id)) : []
      const extra = {
        ...(classes ? { custom_class: classes } : {}),
        ...(dragWith.length ? { _drag_with: dragWith } : {}),
      }
      if (isMilestone(t)) {
        // A milestone carries a single date; it is drawn as a diamond by the
        // Milestone bar subclass in the vendored frappe-gantt fork.
        const d = (t.end ?? t.start)!
        return { id: t.id, name: t.name, start: isoDay(d), end: isoDay(d),
                 progress: 0, dependencies: deps, _milestone: true, ...extra }
      }
      const span = isParent ? subtreeSpan(t.id, tree) : null
      return { id: t.id, name: t.name, start: isoDay(t.start!), end: isoDay(t.end!),
               progress: t.progress, dependencies: deps, ...extra,
               ...(span ? { _span: { start: isoDay(span.start), end: isoDay(span.end) } } : {}) }
    }) as FrappeGanttNS.Task[]

    if (tasks.length === 0) {
      if (ganttRef.current) {
        const oldContainer = (ganttRef.current as any).$container as HTMLElement | null
        ganttRef.current.clear()
        ganttRef.current = null
        oldContainer?.remove()
      }
      emitGeometry()
      return
    }

    if (ganttRef.current) {
      // During an active drag bar_being_dragged is true — skip refresh to keep
      // bar DOM elements intact. React state still updates so LHS stays live.
      // The first render after mouseup (bar_being_dragged = null) does the refresh.
      if ((ganttRef.current as any)?.bar_being_dragged) return

      const gantt = ganttRef.current as any
      const gc = gantt.$container as HTMLElement | null
      const oldGanttStart = gantt.gantt_start ? new Date(gantt.gantt_start) : null
      const sl = gc?.scrollLeft ?? 0
      const st = gc?.scrollTop ?? 0

      ganttRef.current.refresh(frappeTasks)

      if (gc) {
        let newSl = sl
        // If left bound extended, compensate so the visible area doesn't jump
        if (oldGanttStart && gantt.gantt_start < oldGanttStart) {
          const colsAdded = (gantt.dates as Date[]).findIndex(
            (d: Date) => d >= oldGanttStart,
          )
          if (colsAdded > 0) newSl = sl + colsAdded * gantt.config.column_width
        }

        // If a LHS edit triggered this refresh, scroll to show the edited task
        const fid = focusIdRef?.current
        if (fid) {
          focusIdRef!.current = null
          const focusBar = (gantt.bars as any[])?.find(
            (b: any) => b.task?.id === fid,
          )
          if (focusBar) {
            const taskX: number = focusBar.x
            const viewLeft = newSl
            const viewRight = newSl + gc.clientWidth
            if (taskX < viewLeft || taskX + (focusBar.width ?? 0) > viewRight) {
              newSl = Math.max(0, taskX - gc.clientWidth / 3)
            }
          }
        }

        gc.scrollLeft = newSl
        gc.scrollTop = st
      }

      applyCriticalArrows()
      emitGeometry()
    } else {
      const panelHeight = containerRef.current.clientHeight

      ganttRef.current = new FrappeGantt(containerRef.current, frappeTasks, {
        view_mode: 'Week',
        container_height: panelHeight,
        popup: false,
        on_date_change: (task, start, end) => {
          if (!task.id) return
          const allTasks = allTasksRef.current
          const prev = allTasks.find(t => t.id === task.id)
          // A milestone keeps a single date on both fields
          const newEnd = prev && isMilestone(prev) ? start : end
          onDateChangeRef.current(task.id, start, newEnd)
          if (prev && prev.start && prev.end) {
            // Whole calendar days, so stored times of day (frappe's 23:59:59
            // ends, ClickUp's 4 am) and DST changes never skew the comparison
            const startDays = daysBetween(prev.start, start)
            const endDays = daysBetween(prev.end, newEnd)
            // Drag: both ends moved by the same days
            //   -> successors and subtasks (also hidden ones) move along
            // Right-edge resize: only the end moved -> successors only; subtasks keep their dates
            // Left-edge resize: start moved, end did not -> no propagation
            const isDrag = startDays !== 0 && startDays === endDays
            const days = isDrag ? startDays : startDays === 0 ? endDays : 0
            if (days !== 0) {
              const moved = isDrag ? dragClosure(task.id, allTasks) : getAllSuccessors(task.id, allTasks)
              for (const sid of moved) {
                const s = allTasks.find(t => t.id === sid)
                if (s && s.start && s.end) {
                  onDateChangeRef.current(sid, shiftDays(s.start, days), shiftDays(s.end, days))
                }
              }
            }
          }
        },
        on_click: (task) => ganttClickRef.current(task),
      })

      const ganttContainer = (ganttRef.current as any)?.$container as HTMLElement | null
      if (ganttContainer) {
        ganttContainer.style.height = `${panelHeight}px`
        ganttContainer.addEventListener('scroll', emitGeometry, { passive: true })
        onContainerReadyRef.current(ganttContainer)
      }

      applyCriticalArrows()
      emitGeometry()
    }
  }, [tasks, allTasks, rows, criticalIds, criticalEdges]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectLabel = connectSource
    ? `Click the successor task  (Esc to cancel)`
    : `Click the predecessor task  (Esc to cancel)`

  return (
    <div className={`gantt-panel${connectMode ? ' gantt-panel--connecting' : ''}`}>
      <div className="gantt-panel__topbar">
        <button
          className={`gantt-panel__connect-btn${connectMode ? ' gantt-panel__connect-btn--active' : ''}`}
          onClick={toggleConnectMode}
          title="Connect two tasks as predecessor → successor"
        >
          {connectMode ? '✕ Cancel' : '⇢ Connect tasks'}
        </button>
        {connectMode && (
          <span className="gantt-panel__connect-hint">{connectLabel}</span>
        )}
        <div className="gantt-panel__topbar-spacer" />
        {criticalOn && (
          <div className="gantt-panel__crit-scope" role="group" aria-label="Critical path scope">
            <button
              type="button"
              className={`gantt-panel__crit-scope-btn${criticalScope === 'project' ? ' gantt-panel__crit-scope-btn--active' : ''}`}
              onClick={() => onCriticalScopeChange('project')}
              title="Compute the critical path over every task"
            >
              Project
            </button>
            <button
              type="button"
              className={`gantt-panel__crit-scope-btn${criticalScope === 'view' ? ' gantt-panel__crit-scope-btn--active' : ''}`}
              onClick={() => onCriticalScopeChange('view')}
              title="Compute the critical path over the currently visible tasks only"
            >
              View
            </button>
          </div>
        )}
        <button
          type="button"
          className={`gantt-panel__load-btn${loadStripOn ? ' gantt-panel__load-btn--active' : ''}`}
          onClick={onToggleLoadStrip}
          aria-pressed={loadStripOn}
          title="Show how many tasks (or estimated hours) run in each week of this board"
        >
          ▤ Workload
        </button>
        <button
          type="button"
          className={`gantt-panel__crit-btn${criticalOn ? ' gantt-panel__crit-btn--active' : ''}`}
          onClick={onToggleCritical}
          title="Highlight the longest chain of dependent tasks"
        >
          ◆ Critical path
        </button>
      </div>

      {tasks.length === 0 && (
        <p className="gantt-panel__empty-msg">
          Add a task on the left to see the Gantt chart.
        </p>
      )}
      <div
        ref={containerRef}
        className="gantt-panel__chart"
        style={{ display: tasks.length > 0 ? 'block' : 'none' }}
      />
    </div>
  )
}
