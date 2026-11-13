import React, { useContext, useEffect, useReducer, useRef, useState } from 'react'
import FrappeGantt from 'frappe-gantt'
import type FrappeGanttNS from 'frappe-gantt'
import type { CriticalScope, GanttTask } from '../types'
import { getAllSuccessors, isMilestone } from '../utils'
import { edgeKey } from '../lib/criticalPath'
import {
  buildTree, descendants, dragClosure, subtreeSpan, type TreeRow,
} from '../lib/tree'
import { daysBetween, isoDay, shiftDays, type Calendar } from '../lib/dates'
import { statusBarStyle } from '../lib/color'
import type { ClickMods } from '../lib/selection'
import { modKey } from '../lib/keys'
import { reapplyHover, setHover } from '../lib/hover'
import type { Settings } from '../lib/settings'
import { BarTooltip } from './BarTooltip'
import { PeopleContext, avatarColor, initials } from './Avatar'

// Column layout of the rendered chart, for widgets drawn in step with it
export interface GanttGeometry {
  dates: Date[] // start of every column
  columnWidth: number
}

// Fork options (week_start) and frappe's weekend shading for a calendar
function calendarOptions(c: Calendar) {
  return {
    week_start: c.weekStart,
    is_weekend: (d: Date) => !c.workdays.includes(d.getDay()),
  }
}

const calendarKey = (c: Calendar) => `${c.weekStart}:${c.workdays.join(',')}`

export type ViewMode = 'Day' | 'Week' | 'Month'
const VIEW_MODES: ViewMode[] = ['Day', 'Week', 'Month']
const VIEW_KEY = 'gantt-view'

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    const mode = raw ? (JSON.parse(raw) as { mode?: unknown }).mode : undefined
    if (VIEW_MODES.includes(mode as ViewMode)) return mode as ViewMode
  } catch { /* malformed entry */ }
  return 'Week'
}

export interface HistoryControls {
  undoLabel?: string // set = something to undo
  redoLabel?: string
  onUndo: () => void
  onRedo: () => void
}

export interface PathInfo {
  label: string // whose path
  count: number // tasks on it
  onClear: () => void
}

export interface FilterInfo {
  shown: number
  total: number
  onClear: () => void
}

// Whether the task gets a bar (a dateless one is a hidden placeholder row)
const hasBar = (t: GanttTask): boolean => (isMilestone(t) ? !!(t.end ?? t.start) : !!(t.start && t.end))

interface Props {
  tasks: GanttTask[] // the visible rows, in display order
  allTasks: GanttTask[] // every task: subtask spans and date propagation reach hidden rows too
  rows: TreeRow[] // display metadata for `tasks`
  // `key` is the same for every change of one drag gesture (one undo step)
  onDateChange: (id: string, start: Date, end: Date, key?: string) => void
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
  calendar: Calendar
  statusColors: boolean // fill bars with the task's status color
  history: HistoryControls
  leftHidden: boolean // the task list is hidden: its key actions move here
  onShowLeft: () => void
  onAddTask: () => void
  filterInfo?: FilterInfo // filters active
  selectedIds: ReadonlySet<string>
  onSelect: (id: string, mods: ClickMods) => void
  onClearSelection: () => void
  onOpenDetail: (id: string) => void
  settings: Settings
  onOpenMenu: (id: string, x: number, y: number) => void
  path?: { ids: ReadonlySet<string>; edges: ReadonlySet<string>; info: PathInfo }
  violatedEdges?: ReadonlySet<string> // links whose successor starts too early
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
  calendar,
  statusColors,
  history,
  leftHidden,
  onShowLeft,
  onAddTask,
  filterInfo,
  selectedIds,
  onSelect,
  onClearSelection,
  onOpenDetail,
  settings,
  onOpenMenu,
  path,
  violatedEdges,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<InstanceType<typeof FrappeGantt> | null>(null)
  const people = useContext(PeopleContext)
  const barAvatars = settings.board.avatars.bars

  // Always-current refs for callbacks set once at gantt init
  const onDateChangeRef = useRef(onDateChange)
  const onContainerReadyRef = useRef(onContainerReady)
  const onToggleDependencyRef = useRef(onToggleDependency)
  const onGeometryRef = useRef(onGeometry)
  const allTasksRef = useRef(allTasks)
  const calendarRef = useRef(calendar)
  const onSelectRef = useRef(onSelect)
  const onClearSelectionRef = useRef(onClearSelection)
  const onOpenDetailRef = useRef(onOpenDetail)
  const onOpenMenuRef = useRef(onOpenMenu)
  useEffect(() => {
    onDateChangeRef.current = onDateChange
    onContainerReadyRef.current = onContainerReady
    onToggleDependencyRef.current = onToggleDependency
    onGeometryRef.current = onGeometry
    allTasksRef.current = allTasks
    calendarRef.current = calendar
    onSelectRef.current = onSelect
    onClearSelectionRef.current = onClearSelection
    onOpenDetailRef.current = onOpenDetail
    onOpenMenuRef.current = onOpenMenu
  })
  // When the last drag ended: the click that follows a drop is not a click
  // on the empty chart
  const lastDragEndRef = useRef(0)
  // Hover tooltip: the bar under the pointer, after a short delay
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)
  const tipTimerRef = useRef<number | undefined>(undefined)
  // Calendar the live chart was built or last re-rendered with
  const appliedCalendarRef = useRef('')
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  // Bumped on every mousedown on a bar: the date changes of one gesture share
  // an undo step
  const gestureRef = useRef(0)
  // A refresh skipped during a drag; the drop re-runs the effect through dropCount
  const refreshPendingRef = useRef(false)
  const [dropCount, bumpDropCount] = useReducer((n: number) => n + 1, 0)

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
  const ganttClickRef = useRef<(task: FrappeGanttNS.Task, e?: MouseEvent) => void>(null!)
  ganttClickRef.current = (task: FrappeGanttNS.Task, e?: MouseEvent) => {
    if (!task.id) return
    if (!connectModeRef.current) {
      onSelectRef.current(task.id, { shift: !!e?.shiftKey, toggle: !!e && modKey(e) })
      return
    }
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

  // Classes the host puts on frappe's DOM: arrows carry no class of their own
  // (bare paths tagged with data-from / data-to) and bars and arrows are
  // rebuilt on every render, also renders frappe starts itself (the infinite
  // padding on scroll), so everything is re-marked after each one. Never
  // through refresh: these change without the tasks changing.
  function applyDecorations() {
    const root = containerRef.current
    if (!root) return
    root.querySelectorAll<SVGGElement>('.bar-wrapper[data-id]').forEach(el => {
      const id = el.getAttribute('data-id')!
      el.classList.toggle('is-selected', selectedIds.has(id))
      el.classList.toggle('is-dimmed', !!path && !path.ids.has(id))
    })
    root.querySelectorAll<SVGPathElement>('path[data-from][data-to]').forEach(p => {
      const from = p.getAttribute('data-from')!
      const to = p.getAttribute('data-to')!
      const key = edgeKey(from, to)
      p.classList.toggle('arrow--critical', criticalEdges.has(key))
      p.classList.toggle('arrow--violation', !!violatedEdges?.has(key))
      const out = selectedIds.has(from)
      const into = selectedIds.has(to)
      const onPath = !!path?.edges.has(key)
      p.classList.toggle('arrow--sel-out', out)
      p.classList.toggle('arrow--sel-in', into)
      p.classList.toggle('arrow--path', onPath)
      p.classList.toggle('arrow--dimmed', !!path && !onPath)
      // Drawn last, so the highlighted arrows sit on top of the others
      if ((out || into || onPath) && p.parentNode && p !== p.parentNode.lastChild) p.parentNode.appendChild(p)
    })
    reapplyHover()
  }
  const decorateRef = useRef(applyDecorations)
  decorateRef.current = applyDecorations

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

  // Escape cancels connect mode. Capture phase, so it runs before the
  // board's own Escape (clear the selection), which sees it handled.
  useEffect(() => {
    if (!connectMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      toggleConnectMode()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
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
      // Status color: inline fill (beats the milestone / parent CSS fills) and
      // a label color with enough contrast on it
      const look = statusColors ? statusBarStyle(t.statusColor) : null
      // custom_class is a space-joined token list, read by the fork's Bar.refresh
      const classes = [
        isMilestone(t) ? 'milestone' : '',
        isParent ? 'parent' : '',
        row?.context ? 'context' : '',
        criticalIds.has(t.id) ? 'critical' : '',
        look?.faint ? 'status-faint' : '',
      ].filter(Boolean).join(' ')
      // Subtasks (with bars) move along when the parent is dragged
      const dragWith = isParent ? descendants(t.id, tree).map(d => d.id).filter(id => barIds.has(id)) : []
      // Assignees next to the bar (fork's draw_avatars)
      const avatars = barAvatars && t.assignees?.length
        ? t.assignees.map(a => {
            const known = a.id !== -1 ? people.get(a.id) : undefined
            const name = known?.username ?? a.username
            return { name, initials: initials(name), color: known?.color ?? avatarColor(name), url: known?.profilePicture ?? undefined }
          })
        : null
      const extra = {
        ...(avatars ? { _avatars: avatars } : {}),
        ...(classes ? { custom_class: classes } : {}),
        ...(dragWith.length ? { _drag_with: dragWith } : {}),
        ...(look ? { color: look.fill, text_color: look.text } : {}),
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
      const gantt = ganttRef.current as any
      // From mousedown on a bar to the drop bar_being_dragged is false / true
      // (null when idle). A refresh then would rebuild the bars under the
      // pointer, so it waits for the drop (on_drag_end). frappe reports the
      // dates on every drag frame, so the state is already current here: the
      // subtask spans follow the drag in place, LHS stays live.
      if (gantt.bar_being_dragged != null) {
        refreshPendingRef.current = true
        const spans = new Map((frappeTasks as any[]).map(t => [t.id, t._span]))
        for (const bar of gantt.bars ?? []) bar.set_span(spans.get(bar.task.id) ?? null)
        return
      }
      refreshPendingRef.current = false

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

      applyDecorations()
      emitGeometry()
    } else {
      const panelHeight = containerRef.current.clientHeight

      appliedCalendarRef.current = calendarKey(calendarRef.current)
      ganttRef.current = new FrappeGantt(containerRef.current, frappeTasks, {
        ...calendarOptions(calendarRef.current),
        view_mode: viewMode,
        container_height: panelHeight,
        popup: false,
        // The toolbar has its own Today button
        today_button: false,
        on_date_change: (task, start, end) => {
          if (!task.id) return
          const allTasks = allTasksRef.current
          const prev = allTasks.find(t => t.id === task.id)
          // A milestone keeps a single date on both fields
          const newEnd = prev && isMilestone(prev) ? start : end
          const key = `drag:${gestureRef.current}`
          onDateChangeRef.current(task.id, start, newEnd, key)
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
                  onDateChangeRef.current(sid, shiftDays(s.start, days), shiftDays(s.end, days), key)
                }
              }
            }
          }
        },
        on_click: (task: FrappeGanttNS.Task, e?: MouseEvent) => ganttClickRef.current(task, e),
        // Fork events (not in @types/frappe-gantt): pointer released after a
        // drag; any render, including ones frappe starts on its own
        ...{
          on_drag_end: (moved?: boolean) => {
            if (moved) lastDragEndRef.current = performance.now()
            if (refreshPendingRef.current) bumpDropCount()
          },
          on_render: () => decorateRef.current(),
          on_double_click: (task: FrappeGanttNS.Task) => {
            if (!connectModeRef.current && task.id) onOpenDetailRef.current(task.id)
          },
        },
      })

      const ganttContainer = (ganttRef.current as any)?.$container as HTMLElement | null
      if (ganttContainer) {
        ganttContainer.style.height = `${panelHeight}px`
        ganttContainer.addEventListener('scroll', emitGeometry, { passive: true })
        ganttContainer.addEventListener('mousedown', e => {
          window.clearTimeout(tipTimerRef.current)
          setTip(null)
          if ((e.target as Element).closest?.('.bar-wrapper')) gestureRef.current++
        }, true)
        // A click on the empty chart clears the selection (not the click
        // that ends a drag, nor any click in connect mode)
        ganttContainer.addEventListener('click', e => {
          const t = e.target as Element
          if (connectModeRef.current || t.closest?.('.bar-wrapper') || !t.closest?.('svg')) return
          if (performance.now() - lastDragEndRef.current < 300) return
          onClearSelectionRef.current()
        })
        // Right-click on a bar: the task menu (shared with the task list)
        ganttContainer.addEventListener('contextmenu', e => {
          const id = (e.target as Element).closest?.('.bar-wrapper')?.getAttribute('data-id')
          if (!id || connectModeRef.current) return
          e.preventDefault()
          window.clearTimeout(tipTimerRef.current)
          setTip(null)
          onOpenMenuRef.current(id, e.clientX, e.clientY)
        })
        // Hover: row cross-highlight at once, the tooltip after a pause
        ganttContainer.addEventListener('mouseover', e => {
          const wrapper = (e.target as Element).closest?.('.bar-wrapper')
          const id = wrapper?.getAttribute('data-id') ?? null
          setHover(id)
          const from = (e.relatedTarget as Element | null)?.closest?.('.bar-wrapper')
          if (wrapper && from === wrapper) return
          window.clearTimeout(tipTimerRef.current)
          setTip(null)
          if (!id || connectModeRef.current) return
          const { clientX, clientY } = e
          tipTimerRef.current = window.setTimeout(() => {
            const g = ganttRef.current as any
            if (g?.bar_being_dragged != null) return
            setTip({ id, x: clientX, y: clientY })
          }, 350)
        })
        ganttContainer.addEventListener('mouseleave', () => {
          setHover(null)
          window.clearTimeout(tipTimerRef.current)
          setTip(null)
        })
        ganttContainer.addEventListener('scroll', () => {
          window.clearTimeout(tipTimerRef.current)
          setTip(t => (t ? null : t))
        }, { passive: true })
        ganttContainer.addEventListener('wheel', () => {
          window.clearTimeout(tipTimerRef.current)
          setTip(null)
        }, { passive: true })
        onContainerReadyRef.current(ganttContainer)
      }

      applyDecorations()
      emitGeometry()
    }
  }, [tasks, allTasks, rows, criticalIds, criticalEdges, dropCount, statusColors, barAvatars, people]) // eslint-disable-line react-hooks/exhaustive-deps

  // Week start / working days changed in Settings: re-render the columns in
  // place (not through update_options, which would reset options such as
  // container_height to their values at init)
  useEffect(() => {
    const gantt = ganttRef.current as any
    const key = calendarKey(calendar)
    if (!gantt || key === appliedCalendarRef.current) return
    appliedCalendarRef.current = key
    Object.assign(gantt.options, calendarOptions(calendar))
    const gc = gantt.$container as HTMLElement | null
    const st = gc?.scrollTop ?? 0
    gantt.change_view_mode(undefined, true)
    if (gc) gc.scrollTop = st
    applyDecorations()
    emitGeometry()
  }, [calendar]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selection and path changes restyle in place
  useEffect(() => {
    applyDecorations()
  }, [selectedIds, path, violatedEdges]) // eslint-disable-line react-hooks/exhaustive-deps

  // Day / Week / Month: dates computed fresh for the new unit (a refresh
  // would keep the old view's first date, e.g. mid-month in Month view),
  // keeping the date in the middle of the view in the middle
  const appliedViewRef = useRef(viewMode)
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ mode: viewMode }))
    } catch { /* quota */ }
    const gantt = ganttRef.current as any
    if (!gantt || appliedViewRef.current === viewMode) return
    appliedViewRef.current = viewMode
    const gc = gantt.$container as HTMLElement
    const centre = gantt.x_to_date(gc.scrollLeft + gc.clientWidth / 2) as Date
    const st = gc.scrollTop
    const scrollTo = gantt.options.scroll_to
    gantt.options.scroll_to = null
    gantt.change_view_mode(viewMode)
    gantt.options.scroll_to = scrollTo
    gc.scrollLeft = Math.max(0, gantt.date_to_x(centre) - gc.clientWidth / 2)
    gc.scrollTop = st
    applyDecorations()
    emitGeometry()
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function scrollToToday() {
    const gantt = ganttRef.current as any
    gantt?.scroll_current?.()
  }

  const connectLabel = connectSource
    ? `Click the successor task  (Esc to cancel)`
    : `Click the predecessor task  (Esc to cancel)`

  return (
    <div className={`gantt-panel${connectMode ? ' gantt-panel--connecting' : ''}${selectedIds.size ? ' gantt-panel--has-selection' : ''}${path ? ' gantt-panel--path' : ''}`}>
      <div className="gantt-panel__topbar">
        {leftHidden && (
          <>
            <button
              type="button"
              className="gantt-panel__tool-btn"
              onClick={onShowLeft}
              title="Show the task list (\)"
            >
              ☰ Tasks
            </button>
            <button type="button" className="gantt-panel__tool-btn gantt-panel__tool-btn--accent" onClick={onAddTask}>
              + Add task
            </button>
            {filterInfo && (
              <span className="gantt-panel__filter-chip" title="Filters are active in the task list">
                Filtered: {filterInfo.shown} of {filterInfo.total}
                <button type="button" aria-label="Clear filters" title="Clear filters" onClick={filterInfo.onClear}>×</button>
              </span>
            )}
            <span className="gantt-panel__sep" aria-hidden="true" />
          </>
        )}
        <div className="gantt-panel__history" role="group" aria-label="Undo and redo">
          <button
            type="button"
            className="gantt-panel__icon-btn"
            onClick={history.onUndo}
            disabled={!history.undoLabel}
            aria-label="Undo"
            title={history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          >
            ↶
          </button>
          <button
            type="button"
            className="gantt-panel__icon-btn"
            onClick={history.onRedo}
            disabled={!history.redoLabel}
            aria-label="Redo"
            title={history.redoLabel ? `Redo: ${history.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
          >
            ↷
          </button>
        </div>
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
        {path && (
          <span className="gantt-panel__path-chip" title="Tasks off this path are dimmed (Esc clears)">
            Path of {path.info.label} · {path.info.count} task{path.info.count === 1 ? '' : 's'}
            <button type="button" aria-label="Clear path highlight" title="Clear (Esc)" onClick={path.info.onClear}>×</button>
          </span>
        )}
        <div className="gantt-panel__topbar-spacer" />
        <button type="button" className="gantt-panel__tool-btn" onClick={scrollToToday} title="Scroll to today">
          Today
        </button>
        <div className="gantt-panel__zoom" role="group" aria-label="Zoom">
          {VIEW_MODES.map(m => (
            <button
              key={m}
              type="button"
              className={`gantt-panel__zoom-btn${viewMode === m ? ' gantt-panel__zoom-btn--active' : ''}`}
              aria-pressed={viewMode === m}
              onClick={() => setViewMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
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
      {tip && (() => {
        const t = allTasks.find(x => x.id === tip.id)
        return t ? (
          <BarTooltip task={t} allTasks={allTasks} x={tip.x} y={tip.y} settings={settings} />
        ) : null
      })()}
    </div>
  )
}
