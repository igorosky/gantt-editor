import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPending, loadTasks, useTasks } from './hooks/useTasks'
import { useClickUpConfig } from './hooks/useClickUpConfig'
import { useBoards } from './hooks/useBoards'
import { useWorkspaceTree } from './hooks/useWorkspaceTree'
import { TaskPanel } from './components/TaskPanel'
import { GanttPanel } from './components/GanttPanel'
import { Divider } from './components/Divider'
import { ClickUpSettings } from './components/ClickUpSettings'
import { BoardSwitcher, LinkBoardDialog } from './components/BoardSwitcher'
import { SettingsDialog } from './components/SettingsDialog'
import { TaskDetailPopup } from './components/TaskDetailPopup'
import { ExportDialog } from './components/ExportDialog'
import { SyncLogDialog } from './components/SyncLogDialog'
import { SyncConflictDialog } from './components/SyncConflictDialog'
import { SyncDeleteDialog } from './components/SyncDeleteDialog'
import { PendingDeletionsDialog } from './components/PendingDeletionsDialog'
import { WorkloadStrip } from './components/WorkloadStrip'
import { Toasts, useToasts } from './components/Toasts'
import { ContextMenu } from './components/ContextMenu'
import { ShiftDatesDialog } from './components/ShiftDatesDialog'
import { AssigneePicker } from './components/AssigneePicker'
import { PeopleContext, type Person } from './components/Avatar'
import { QuickFind, type FindState } from './components/QuickFind'
import { ShortcutHelp } from './components/ShortcutHelp'
import { flashTask } from './lib/hover'
import { GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT } from './constants'
import { usePeople } from './hooks/usePeople'
import { useListStatuses } from './hooks/useListStatuses'
import { buildTaskMenu } from './lib/taskMenu'
import {
  dependencyPath, dependencyRefusal, dependencyViolations, snapAfterPredecessors, violatedPredecessors, type PathDirection,
} from './lib/depGraph'
import { defaultStatus, statusPatch } from './lib/statuses'
import { taskLabel } from './lib/taskPatch'
import { PortfolioView } from './components/portfolio/PortfolioView'
import type { GanttGeometry } from './components/GanttPanel'
import { useHashRoute } from './hooks/useHashRoute'
import { usePortfolio } from './hooks/usePortfolio'
import { useSyncLog } from './hooks/useSyncLog'
import { useSettings } from './hooks/useSettings'
import { withoutBacklog } from './lib/settings'
import type { WorkloadMetric } from './lib/workload'
import { applyFilters, getAllSuccessors } from './utils'
import {
  boardMilestones, latestUpdate, pullFromClickUp, pushToClickUp, remoteMilestones, type DeletionDecision,
} from './lib/sync'
import { pendingCuids, planDeletions, type DeletionCandidate } from './lib/deletions'
import { findConflicts, resolveConflicts, type Resolution, type SyncConflict } from './lib/conflicts'
import { getAllTasks, type RemoteTask } from './lib/clickup'
import { runFailed, runSummary } from './lib/syncLog'
import { boardPatchFromRemote, boardSummary } from './lib/boards'
import type { ProjectRef } from './lib/portfolioData'
import { EMPTY_CRITICAL, computeCriticalPath } from './lib/criticalPath'
import { ancestors, buildTree, descendants, dragClosure, flattenTree } from './lib/tree'
import { daysBetween, shiftDays } from './lib/dates'
import { isActivationTarget, isTypingTarget, modKey } from './lib/keys'
import {
  EMPTY_SELECTION, click as clickSelection, inOrder, lastInOrder, prune as pruneSelection, step as stepSelection,
  type ClickMods, type Selection,
} from './lib/selection'
import type { CriticalScope, Filter, GanttTask, SyncDirection, SyncLogEntry } from './types'
import './App.css'

const MIN_PCT = 15
const MAX_PCT = 70
const DEFAULT_PCT = 30

const CRITICAL_KEY = 'gantt-critical'

function loadCritical(): { on: boolean; scope: CriticalScope } {
  try {
    const raw = localStorage.getItem(CRITICAL_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { on?: boolean; scope?: CriticalScope }
      return { on: !!p.on, scope: p.scope === 'view' ? 'view' : 'project' }
    }
  } catch { /* malformed entry */ }
  return { on: false, scope: 'project' }
}

const LOAD_STRIP_KEY = 'gantt-load-strip'

function loadStripPrefs(): { on: boolean; metric: WorkloadMetric } {
  try {
    const raw = localStorage.getItem(LOAD_STRIP_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { on?: boolean; metric?: WorkloadMetric }
      return { on: !!p.on, metric: p.metric === 'hours' ? 'hours' : 'count' }
    }
  } catch { /* malformed entry */ }
  return { on: false, metric: 'count' }
}

const LAYOUT_KEY = 'gantt-layout'

// Width of the task list (percent) and whether it is hidden
function loadLayout(): { leftPct: number; leftHidden: boolean } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { leftPct?: unknown; leftHidden?: unknown }
      const pct = typeof p.leftPct === 'number' && Number.isFinite(p.leftPct)
        ? Math.min(MAX_PCT, Math.max(MIN_PCT, p.leftPct))
        : DEFAULT_PCT
      return { leftPct: pct, leftHidden: p.leftHidden === true }
    }
  } catch { /* malformed entry */ }
  return { leftPct: DEFAULT_PCT, leftHidden: false }
}

const COLLAPSED_KEY = 'gantt-collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) return new Set(p.filter((x): x is string => typeof x === 'string'))
    }
  } catch { /* malformed entry */ }
  return new Set()
}

export default function App() {
  const boards = useBoards()
  const board = boards.current
  const {
    tasks, setTasks, commitTask, removeTask, removeTasks, updateTask, updateTasks, moveTask, sortTasks, setTaskParent,
    indentTask, outdentTask, clearTasks, pending, restorePending, dropPending, prunePendingFor, storageFull,
    undo, redo, undoLabel, redoLabel,
  } = useTasks(board.id)
  const toast = useToasts()
  const { config, setConfig, clearConfig } = useClickUpConfig()
  const workspace = useWorkspaceTree(config?.token, config?.teamId)
  const people = usePeople(config?.token, config?.teamId)
  const listStatuses = useListStatuses(config?.token, board.listId)
  const [linkOpen, setLinkOpen] = useState(false)
  const { settings, setSettings } = useSettings()
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [layout, setLayout] = useState(loadLayout)
  const leftPct = layout.leftPct
  const leftHidden = layout.leftHidden
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [newTaskDraft, setNewTaskDraft] = useState<GanttTask | null>(null)
  const [syncBusy, setSyncBusy] = useState<SyncDirection | null>(null)
  // Fetched ClickUp list held while the user resolves the conflicts, then
  // answers the deletion questions of a push
  const [pendingSync, setPendingSync] = useState<{
    direction: SyncDirection
    remote: RemoteTask[]
    startedAt: string
    fetchMs: number
    conflicts: SyncConflict[]
    resolution?: { conflicts: SyncConflict[]; picks: Map<string, Resolution> }
    deletions: DeletionCandidate[]
    stage: 'conflicts' | 'deletions'
  } | null>(null)
  const [syncLogOpen, setSyncLogOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const syncLog = useSyncLog(board.id)
  const [filters, setFilters] = useState<Filter[]>([])
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all')
  // Backlog tasks can be left off the board (Settings); pull / push still see them
  const boardTasks = useMemo(() => withoutBacklog(tasks, settings, 'board'), [tasks, settings])
  const filteredTasks = useMemo(
    () => applyFilters(boardTasks, filters, matchMode),
    [boardTasks, filters, matchMode],
  )
  // Subtasks of a collapsed task are hidden; while filtering (or hiding the
  // backlog), the ancestors of a shown task appear as context rows. Both
  // panels get the same rows.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const tree = useMemo(() => buildTree(tasks), [tasks])
  const narrowed = filters.length > 0 || boardTasks !== tasks
  const rows = useMemo(
    () => flattenTree(tasks, {
      collapsed,
      include: narrowed ? new Set(filteredTasks.map(t => t.id)) : undefined,
    }),
    [tasks, collapsed, narrowed, filteredTasks],
  )
  const visibleTasks = useMemo(() => rows.map(r => r.task), [rows])
  const rowOrder = useMemo(() => visibleTasks.map(t => t.id), [visibleTasks])
  // Selected tasks (both panels); ids of deleted tasks drop out
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  useEffect(() => {
    setSelection(s => pruneSelection(s, id => tree.byId.has(id)))
  }, [tree])
  const selectTask = useCallback((id: string, mods: ClickMods = {}) => {
    setSelection(s => clickSelection(s, rowOrder, id, mods))
  }, [rowOrder])
  const clearSelection = useCallback(() => setSelection(s => (s.ids.size ? EMPTY_SELECTION : s)), [])
  // F2 / menu Rename: the row with this id starts editing its name
  const [renameRequest, setRenameRequest] = useState<{ id: string; n: number } | null>(null)
  // The task menu (row right-click / ⋯, bar right-click) and what it acts on
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; align: 'left' | 'right' } | null>(null)
  // A highlighted dependency path: everything off it is dimmed
  const [pathFocus, setPathFocus] = useState<{ roots: string[]; dir: PathDirection } | null>(null)
  const path = useMemo(
    () => (pathFocus ? dependencyPath(tasks, pathFocus.roots, pathFocus.dir) : null),
    [tasks, pathFocus],
  )
  useEffect(() => {
    if (pathFocus && !pathFocus.roots.some(id => tree.byId.has(id))) setPathFocus(null)
  }, [tree, pathFocus])
  const [shiftFor, setShiftFor] = useState<string[] | null>(null)
  const [assignFor, setAssignFor] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  // Opens the details popup with a dependency picker open
  const [detailPicker, setDetailPicker] = useState<'pred' | 'succ' | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // A task to bring into view (and flash) once the rows show it
  const revealRef = useRef<{ id: string; flash: boolean; tries: number } | null>(null)
  const [revealTick, setRevealTick] = useState(0)
  const [criticalOn, setCriticalOn] = useState(() => loadCritical().on)
  const [criticalScope, setCriticalScope] = useState<CriticalScope>(() => loadCritical().scope)
  const critical = useMemo(
    () => (criticalOn
      ? computeCriticalPath(criticalScope === 'view' ? filteredTasks : tasks)
      : EMPTY_CRITICAL),
    [criticalOn, criticalScope, tasks, filteredTasks],
  )
  const [route, navigate] = useHashRoute()
  // The ClickUp tag that marks a milestone, when milestones are stored that way
  const milestoneTag = settings.milestones.as === 'tag' ? settings.milestones.tag : undefined
  const portfolio = usePortfolio(tasks, config, board.listId, settings.warnings.dodKeywords, settings.milestones)
  // Status names offered as backlog candidates in Settings
  const knownStatuses = useMemo(() => {
    const names = new Set<string>()
    for (const t of tasks) if (t.status) names.add(t.status)
    for (const p of portfolio.projects) for (const t of p.tasks) if (t.status) names.add(t.status)
    return [...names]
  }, [tasks, portfolio.projects])
  // Tag names offered as required tags in Settings
  const knownTags = useMemo(() => {
    const names = new Set<string>()
    for (const t of tasks) for (const tag of t.tags ?? []) names.add(tag.name)
    for (const p of portfolio.projects) for (const t of p.tasks) for (const tag of t.tags ?? []) names.add(tag.name)
    return [...names]
  }, [tasks, portfolio.projects])
  const [loadStripOn, setLoadStripOn] = useState(() => loadStripPrefs().on)
  const [loadMetric, setLoadMetric] = useState<WorkloadMetric>(() => loadStripPrefs().metric)
  const [ganttGeometry, setGanttGeometry] = useState<GanttGeometry | null>(null)
  const [ganttContainer, setGanttContainer] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const taskListRef = useRef<HTMLDivElement>(null)
  const isSyncingRef = useRef(false)
  const scrollCleanupRef = useRef<(() => void) | null>(null)
  const lhsFocusIdRef = useRef<string | null>(null)
  // Pull / push read the newest tasks after awaiting the fetch or a confirm
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  useEffect(() => {
    try {
      localStorage.setItem(CRITICAL_KEY, JSON.stringify({ on: criticalOn, scope: criticalScope }))
    } catch { /* quota */ }
  }, [criticalOn, criticalScope])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
    } catch { /* quota */ }
  }, [collapsed])

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
    } catch { /* quota */ }
  }, [layout])

  const setLeftHidden = useCallback((hidden: boolean) => {
    setLayout(l => (l.leftHidden === hidden ? l : { ...l, leftHidden: hidden }))
  }, [])

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expand = useCallback((id: string) => {
    setCollapsed(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LOAD_STRIP_KEY, JSON.stringify({ on: loadStripOn, metric: loadMetric }))
    } catch { /* quota */ }
  }, [loadStripOn, loadMetric])

  // Applies a pull or push to the fetched list, then logs it. Resolved
  // conflicts (`resolution`) override what the operation would do; a push
  // deletes in ClickUp what `deletions` confirms. lastSyncAt
  // is the fallback baseline for tasks without a syncBase; it never goes below
  // ClickUp's own clock, so a client clock behind ClickUp's does not make the
  // tasks just written look changed in ClickUp.
  const applySync = useCallback(async (
    direction: SyncDirection, remote: RemoteTask[], startedAt: string, fetchMs: number,
    resolution?: { conflicts: SyncConflict[]; picks: Map<string, Resolution> },
    deletions?: DeletionDecision[],
  ) => {
    if (!config?.token || !board.listId) return
    setSyncBusy(direction)
    const t0 = performance.now()
    try {
      const resolved = resolution
        ? resolveConflicts(direction, resolution.conflicts, resolution.picks, tasksRef.current, remote)
        : undefined
      let entries: SyncLogEntry[]
      let clock: number
      if (direction === 'pull') {
        const res = pullFromClickUp(tasksRef.current, remote, resolved?.overrides, pendingCuids(pendingRef.current))
        setTasks(res.tasks)
        entries = res.entries
        clock = latestUpdate(remote)
      } else {
        const res = await pushToClickUp(
          { token: config.token, listId: board.listId, milestones: settings.milestones },
          tasksRef.current, remote, resolved?.overrides, deletions,
        )
        // Patch by id, so edits made while the push ran survive
        setTasks(prev => prev.map(t => {
          const p = res.patches.get(t.id)
          return p ? { ...t, ...p } : t
        }))
        dropPending(res.settled)
        entries = res.entries
        clock = res.latestUpdate
      }
      if (resolved) entries = [...resolved.log, ...entries]
      boards.patch(board.id, {
        ...boardPatchFromRemote(board, remote),
        lastSyncAt: new Date(Math.max(Date.now(), clock)).toISOString(),
      })
      syncLog.addRun({ direction, at: startedAt, durationMs: fetchMs + performance.now() - t0, entries })
    } catch (e) {
      syncLog.addRun({
        direction, at: startedAt, durationMs: fetchMs + performance.now() - t0, entries: [],
        aborted: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSyncBusy(null)
    }
  }, [config, board, settings.milestones, boards.patch, setTasks, syncLog.addRun, dropPending])

  // Fetches the list, then applies straight away unless the operation would
  // overwrite changes made on the other side, which the user resolves first,
  // or a push would delete tasks deleted on the board, which the user confirms.
  // With tag milestones both sides are read through the marker tag first.
  const startSync = useCallback(async (direction: SyncDirection) => {
    if (!config?.token || !board.listId || syncBusy) return
    setSyncBusy(direction)
    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    const marked = boardMilestones(tasksRef.current, settings.milestones)
    if (marked !== tasksRef.current) {
      tasksRef.current = marked
      setTasks(prev => boardMilestones(prev, settings.milestones))
    }
    let remote: RemoteTask[]
    try {
      remote = remoteMilestones(await getAllTasks(config.token, board.listId), settings.milestones)
    } catch (e) {
      syncLog.addRun({
        direction, at: startedAt, durationMs: performance.now() - t0, entries: [],
        aborted: e instanceof Error ? e.message : String(e),
      })
      setSyncBusy(null)
      return
    }
    const fetchMs = performance.now() - t0
    prunePendingFor(remote)
    const lastSyncMs = board.lastSyncAt ? Date.parse(board.lastSyncAt) : 0
    const conflicts = findConflicts(direction, tasksRef.current, remote, lastSyncMs)
    const deletions = direction === 'push' ? planDeletions(pendingRef.current, tasksRef.current, remote) : []
    if (conflicts.length || deletions.length) {
      setSyncBusy(null)
      setPendingSync({
        direction, remote, startedAt, fetchMs, conflicts, deletions,
        stage: conflicts.length ? 'conflicts' : 'deletions',
      })
      return
    }
    await applySync(direction, remote, startedAt, fetchMs)
  }, [config, board, syncBusy, settings.milestones, setTasks, applySync, syncLog.addRun, prunePendingFor])

  // A list opened for the first time (linked, never synced, no tasks) pulls
  // straight away; a failed first pull tries again on the next visit
  const autoPulledRef = useRef<string | null>(null)
  useEffect(() => {
    const firstOpen = !!config?.token && !!board.listId && !board.lastSyncAt && tasksRef.current.length === 0
    if (!firstOpen) {
      autoPulledRef.current = null
      return
    }
    if (autoPulledRef.current === board.id) return
    autoPulledRef.current = board.id
    void startSync('pull')
  }, [board.id, board.listId, config?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switching is off while a pull / push runs or waits for a dialog: its
  // results are applied to the board shown
  const switchBlocked = syncBusy
    ? 'Wait for the pull / push to finish'
    : pendingSync ? 'Finish or cancel the pull / push first' : undefined

  const leaveBoard = useCallback(() => {
    setDetailTaskId(null)
    setNewTaskDraft(null)
    setSelection(EMPTY_SELECTION)
    setPathFocus(null)
    setMenu(null)
    setShiftFor(null)
    setAssignFor(null)
  }, [])

  const switchBoard = useCallback((id: string) => {
    if (switchBlocked) return
    leaveBoard()
    boards.switchTo(id)
  }, [switchBlocked, leaveBoard, boards.switchTo])

  const openListBoard = useCallback((ref: ProjectRef) => {
    if (switchBlocked) return
    leaveBoard()
    boards.openList(ref)
  }, [switchBlocked, leaveBoard, boards.openList])

  const newLocalBoard = useCallback(() => {
    if (switchBlocked) return
    leaveBoard()
    boards.newLocal()
  }, [switchBlocked, leaveBoard, boards.newLocal])

  const renameBoard = useCallback((id: string) => {
    const b = boards.boards.find(x => x.id === id)
    if (!b) return
    const name = prompt('Board name', b.name)
    if (name !== null) boards.rename(id, name)
  }, [boards.boards, boards.rename])

  // Only this browser's copy goes; say what nothing else holds
  const removeBoard = useCallback((id: string) => {
    const b = boards.boards.find(x => x.id === id)
    if (!b) return
    const s = boardSummary(loadTasks(id), loadPending(id))
    const lost: string[] = []
    if (s.boardOnly) lost.push(`${s.boardOnly} task${s.boardOnly === 1 ? '' : 's'} that ${s.boardOnly === 1 ? 'is' : 'are'} not in ClickUp`)
    if (s.pending) lost.push(`${s.pending} pending deletion${s.pending === 1 ? '' : 's'}`)
    const msg = [
      `Remove "${b.name}" from this browser?`,
      b.listId ? 'The ClickUp list is not touched, but edits not pushed yet are lost. Opening the list again pulls it fresh.' : '',
      lost.length ? `Lost for good: ${lost.join(', ')}.` : '',
    ].filter(Boolean).join('\n\n')
    if (confirm(msg)) boards.remove(id)
  }, [boards.boards, boards.remove])

  const handleResize = useCallback((deltaX: number) => {
    const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth
    setLayout(prev => {
      const newPct = prev.leftPct + (deltaX / containerWidth) * 100
      return { ...prev, leftPct: Math.min(MAX_PCT, Math.max(MIN_PCT, newPct)) }
    })
  }, [])

  const handleTaskUpdate = useCallback(
    (id: string, patch: Partial<GanttTask>) => {
      lhsFocusIdRef.current = id
      updateTask(id, patch)
      if ('end' in patch && patch.end !== undefined) {
        const prev = tasks.find(t => t.id === id)
        if (prev && prev.end !== undefined) {
          // In calendar days: the old end may carry a time of day (23:59:59
          // after a drag, 4 am from ClickUp) the picked date does not
          const days = daysBetween(prev.end, patch.end)
          if (days !== 0) {
            for (const sid of getAllSuccessors(id, tasks)) {
              const s = tasks.find(t => t.id === sid)
              if (s && s.start && s.end) {
                updateTask(sid, {
                  start: shiftDays(s.start, days),
                  end: shiftDays(s.end, days),
                })
              }
            }
          }
        }
      }
    },
    [tasks, updateTask],
  )

  // A new task on a linked board starts in the list's first status, as in
  // ClickUp (the popup fills it in if the statuses are still loading)
  const draftStatus = useMemo(() => {
    const s = board.listId && listStatuses.statuses ? defaultStatus(listStatuses.statuses) : undefined
    return s ? statusPatch(s) : {}
  }, [board.listId, listStatuses.statuses])

  const handleAddTask = useCallback(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    const end = new Date(t)
    end.setDate(end.getDate() + 7)
    setNewTaskDraft({ id: crypto.randomUUID(), name: 'New task', start: t, end, progress: 0, ...draftStatus })
  }, [draftStatus])

  // A new subtask starts on its parent's dates
  const handleAddSubtask = useCallback((parentId: string) => {
    const p = tasks.find(t => t.id === parentId)
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    const week = new Date(t)
    week.setDate(week.getDate() + 7)
    const start = p?.start ?? p?.end ?? t
    const end = p?.end ?? p?.start ?? week
    setDetailTaskId(null)
    setNewTaskDraft({ id: crypto.randomUUID(), name: 'New subtask', start, end, progress: 0, parentId, ...draftStatus })
  }, [tasks, draftStatus])

  // Selects a task and scrolls both panels to it once it is on screen; with
  // `flash` it lights up briefly
  const bringIntoView = useCallback((id: string, flash: boolean) => {
    setSelection({ ids: new Set([id]), anchor: id })
    revealRef.current = { id, flash, tries: 0 }
    setRevealTick(n => n + 1)
  }, [])

  // The new task and the links of its successors land in one undo step;
  // the new task is then selected, scrolled to and flashed
  const handleCommitDraft = useCallback((successors: string[] = []) => {
    if (!newTaskDraft) return
    commitTask(newTaskDraft, successors)
    if (newTaskDraft.parentId) expand(newTaskDraft.parentId)
    setNewTaskDraft(null)
    bringIntoView(newTaskDraft.id, true)
  }, [newTaskDraft, commitTask, expand, bringIntoView])

  // `succ` depends on `pred`, or no longer does; a link that would close a
  // loop is refused with a note
  const setLink = useCallback((pred: string, succ: string, on: boolean) => {
    const target = tasks.find(t => t.id === succ)
    if (!target) return
    const deps = target.dependencies ?? []
    if (!on) {
      if (deps.includes(pred)) {
        updateTask(succ, { dependencies: deps.filter(d => d !== pred) }, {
          label: `Unlink ${taskLabel(tree.byId.get(pred))} -> ${taskLabel(target)}`,
        })
      }
      return
    }
    const why = dependencyRefusal(tasks, pred, succ)
    if (why === 'Already linked') return
    if (why) {
      toast.push(`${why}: ${taskLabel(tree.byId.get(pred))} -> ${taskLabel(target)}`, { kind: 'error' })
      return
    }
    updateTask(succ, { dependencies: [...deps, pred] }, {
      label: `Link ${taskLabel(tree.byId.get(pred))} -> ${taskLabel(target)}`,
    })
  }, [tasks, tree, updateTask, toast.push])

  // Deletes tasks with their subtasks (asks when that is more than one task),
  // then offers an undo while nothing else was done
  const deleteToastRef = useRef<{ id: number; label: string } | null>(null)
  const undoRef = useRef<() => void>(() => {})
  const deleteTasks = useCallback((ids: string[]) => {
    const roots = ids.filter(id => tree.byId.has(id))
    if (!roots.length) return
    const all = new Set(roots.flatMap(id => [id, ...descendants(id, tree).map(t => t.id)]))
    const extra = all.size - roots.length
    if (roots.length === 1) {
      const t = tree.byId.get(roots[0])!
      if (extra > 0 && !confirm(`Delete "${t.name}" and its ${extra} subtask${extra === 1 ? '' : 's'}?`)) return
      removeTask(roots[0])
    } else {
      if (!confirm(`Delete ${roots.length} tasks${extra ? ` and ${extra} subtask${extra === 1 ? '' : 's'}` : ''}?`)) return
      removeTasks(roots)
    }
    const label = roots.length === 1 ? `Delete ${taskLabel(tree.byId.get(roots[0]))}` : `Delete ${roots.length} tasks`
    const text = roots.length === 1 ? `Deleted ${taskLabel(tree.byId.get(roots[0]))}` : `Deleted ${all.size} tasks`
    const id = toast.push(text, { action: { label: 'Undo', run: () => undoRef.current() } })
    deleteToastRef.current = { id, label }
  }, [tree, removeTask, removeTasks, toast.push])

  // Moves tasks by whole days, each with what moves along in a drag (its
  // successors and subtasks), every task once: one undo step
  const shiftClosure = useCallback((ids: string[]) => {
    const moved = new Set<string>()
    for (const id of ids) {
      moved.add(id)
      for (const d of dragClosure(id, tasks)) moved.add(d)
    }
    return moved
  }, [tasks])
  const shiftTasks = useCallback((ids: string[], days: number, label: string) => {
    const patches = new Map<string, Partial<GanttTask>>()
    for (const id of shiftClosure(ids)) {
      const t = tree.byId.get(id)
      if (t?.start && t.end) patches.set(id, { start: shiftDays(t.start, days), end: shiftDays(t.end, days) })
    }
    updateTasks(patches, label)
  }, [shiftClosure, tree, updateTasks])

  // Links the tasks one after another in row order; a link that would close
  // a loop is skipped
  const linkAsChain = useCallback((ids: string[]) => {
    let working = tasks
    const deps = new Map<string, string[]>()
    let added = 0
    let refused = 0
    for (let i = 1; i < ids.length; i++) {
      const pred = ids[i - 1]
      const succ = ids[i]
      const why = dependencyRefusal(working, pred, succ)
      if (why === 'Already linked') continue
      if (why) { refused++; continue }
      const s = working.find(t => t.id === succ)!
      const next = [...(s.dependencies ?? []), pred]
      deps.set(succ, next)
      working = working.map(t => (t.id === succ ? { ...t, dependencies: next } : t))
      added++
    }
    if (added) updateTasks(new Map([...deps].map(([id, d]) => [id, { dependencies: d }])), `Link ${ids.length} tasks as a chain`)
    toast.push(
      `${added ? `Added ${added} link${added === 1 ? '' : 's'}` : 'No new links'}${refused ? `, skipped ${refused} that would create a loop` : ''}`,
      { kind: refused && !added ? 'error' : 'info' },
    )
  }, [tasks, updateTasks, toast.push])

  const unlinkTasks = useCallback((ids: string[]) => {
    const set = new Set(ids)
    const patches = new Map<string, Partial<GanttTask>>()
    for (const id of ids) {
      const t = tree.byId.get(id)
      const deps = t?.dependencies ?? []
      if (deps.some(d => set.has(d))) patches.set(id, { dependencies: deps.filter(d => !set.has(d)) })
    }
    updateTasks(patches, `Unlink ${ids.length} tasks`)
  }, [tree, updateTasks])

  const setStatusOf = useCallback((ids: string[], name: string) => {
    const s = listStatuses.statuses?.find(x => x.status === name)
    if (!s) return
    const label = ids.length === 1 ? `Set status of ${taskLabel(tree.byId.get(ids[0]))}` : `Set status of ${ids.length} tasks`
    updateTasks(new Map(ids.map(id => [id, statusPatch(s)])), label)
  }, [listStatuses.statuses, tree, updateTasks])

  const setPriorityOf = useCallback((ids: string[], priority: GanttTask['priority']) => {
    const label = ids.length === 1 ? `Set priority of ${taskLabel(tree.byId.get(ids[0]))}` : `Set priority of ${ids.length} tasks`
    updateTasks(new Map(ids.map(id => [id, { priority }])), label)
  }, [tree, updateTasks])

  // Bulk assign: someone all the tasks have is removed from all, anyone
  // else is added to all
  const toggleAssigneeOf = useCallback((ids: string[], m: Person) => {
    const ts = ids.map(id => tree.byId.get(id)).filter((t): t is GanttTask => !!t)
    const all = ts.every(t => (t.assignees ?? []).some(a => a.id === m.id))
    const patches = new Map<string, Partial<GanttTask>>()
    for (const t of ts) {
      const cur = t.assignees ?? []
      const has = cur.some(a => a.id === m.id)
      if (all) patches.set(t.id, { assignees: cur.filter(a => a.id !== m.id) })
      else if (!has) patches.set(t.id, { assignees: [...cur, { id: m.id, username: m.username }] })
    }
    updateTasks(patches, `${all ? 'Unassign' : 'Assign'} ${m.username}`)
  }, [tree, updateTasks])

  // Collapse every task that has subtasks, or expand everything
  const setAllCollapsed = useCallback((on: boolean) => {
    setCollapsed(on ? new Set(tree.children.keys()) : new Set())
  }, [tree])

  const handleDraftUpdate = useCallback((patch: Partial<GanttTask>) => {
    setNewTaskDraft(prev => prev ? { ...prev, ...patch } : null)
  }, [])

  // Connect mode: the second click adds the link, or removes an existing one
  const handleToggleDependency = useCallback(
    (sourceId: string, targetId: string) => {
      const target = tasks.find(t => t.id === targetId)
      if (!target) return
      setLink(sourceId, targetId, !(target.dependencies ?? []).includes(sourceId))
    },
    [tasks, setLink],
  )

  // Late starts (a successor starting before its predecessor ends), when the
  // warning is on
  const violations = useMemo(
    () => (settings.board.dependencyWarnings ? dependencyViolations(tasks) : null),
    [tasks, settings.board.dependencyWarnings],
  )
  const lateStarts = useMemo(() => {
    const out = new Map<string, string[]>()
    if (!violations?.size) return out
    for (const t of tasks) {
      const late = violatedPredecessors(tasks, t.id)
      if (late.length) out.set(t.id, late.map(p => p.name))
    }
    return out
  }, [tasks, violations])

  const handleContainerReady = useCallback((ganttContainer: HTMLElement) => {
    setGanttContainer(ganttContainer)
    const listEl = taskListRef.current
    if (!listEl) return

    scrollCleanupRef.current?.()

    const syncGanttToList = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      listEl.scrollTop = ganttContainer.scrollTop
      isSyncingRef.current = false
    }

    const syncListToGantt = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      ganttContainer.scrollTop = listEl.scrollTop
      isSyncingRef.current = false
    }

    ganttContainer.addEventListener('scroll', syncGanttToList)
    listEl.addEventListener('scroll', syncListToGantt)

    scrollCleanupRef.current = () => {
      ganttContainer.removeEventListener('scroll', syncGanttToList)
      listEl.removeEventListener('scroll', syncListToGantt)
    }
  }, [])

  // The hidden task list stays mounted (scroll sync is wired to it); shown
  // again it takes the gantt's scroll position
  useEffect(() => {
    if (leftHidden) return
    const list = taskListRef.current
    if (list && ganttContainer) list.scrollTop = ganttContainer.scrollTop
  }, [leftHidden, ganttContainer])

  // Scrolls the list (the chart follows) and the chart so the row and bar
  // of `id` are in view
  const revealTask = useCallback((id: string) => {
    const i = rowOrder.indexOf(id)
    if (i < 0) return
    const list = taskListRef.current
    const gc = ganttContainer
    const top = i * GANTT_ROW_HEIGHT
    const scroller = list && !leftHidden ? list : gc
    if (scroller) {
      const viewH = scroller === gc ? scroller.clientHeight - GANTT_HEADER_HEIGHT : scroller.clientHeight
      const st = scroller.scrollTop
      if (top < st) scroller.scrollTop = top
      else if (top + GANTT_ROW_HEIGHT > st + viewH) scroller.scrollTop = top + GANTT_ROW_HEIGHT - viewH
    }
    const b = gc?.querySelector<SVGGraphicsElement>(`.bar-wrapper[data-id="${CSS.escape(id)}"] .bar`)
    if (gc && b && getComputedStyle(b).visibility !== 'hidden') {
      const x = Number(b.getAttribute('x'))
      const w = Number(b.getAttribute('width'))
      if (x < gc.scrollLeft || x + w > gc.scrollLeft + gc.clientWidth) gc.scrollLeft = Math.max(0, x - gc.clientWidth / 3)
    }
  }, [rowOrder, ganttContainer, leftHidden])

  useEffect(() => {
    const r = revealRef.current
    if (!r) return
    if (!rowOrder.includes(r.id)) {
      // Not on screen yet (filters / collapse being undone): wait one more round
      if (++r.tries > 2) revealRef.current = null
      return
    }
    revealRef.current = null
    revealTask(r.id)
    if (r.flash) flashTask(r.id)
  }, [rowOrder, revealTick, revealTask])

  // Why a task is not on screen (quick find)
  const boardIds = useMemo(() => new Set(boardTasks.map(t => t.id)), [boardTasks])
  const matchIds = useMemo(() => new Set(filteredTasks.map(t => t.id)), [filteredTasks])
  const rowIdSet = useMemo(() => new Set(rowOrder), [rowOrder])
  const findState = useCallback((id: string): FindState => {
    if (!boardIds.has(id)) return 'backlog'
    if (rowIdSet.has(id)) return 'shown'
    if (filters.length && !matchIds.has(id)) return 'filtered'
    return 'collapsed'
  }, [boardIds, rowIdSet, filters.length, matchIds])

  // Quick find: clears the filters / opens the collapsed parents a task
  // needs, then selects, scrolls to and flashes it. A backlog task the board
  // hides (Settings) opens in the details popup instead.
  const jumpTo = useCallback((id: string) => {
    setFindOpen(false)
    const state = findState(id)
    if (state === 'backlog') {
      setSelection(EMPTY_SELECTION)
      setDetailPicker(null)
      setDetailTaskId(id)
      return
    }
    if (state === 'filtered') setFilters([])
    const up = ancestors(id, tree)
    setCollapsed(prev => {
      if (!up.some(a => prev.has(a))) return prev
      const next = new Set(prev)
      for (const a of up) next.delete(a)
      return next
    })
    bringIntoView(id, true)
  }, [findState, tree, bringIntoView])

  // Rename in the row; with the task list hidden, in the details popup
  const startRename = useCallback((id: string) => {
    if (leftHidden) {
      setDetailPicker(null)
      setDetailTaskId(id)
      return
    }
    setRenameRequest(r => ({ id, n: (r?.n ?? 0) + 1 }))
  }, [leftHidden])

  const openDetail = useCallback((id: string, picker: 'pred' | 'succ' | null = null) => {
    setSelection(s => (s.ids.size === 1 && s.ids.has(id) ? s : { ids: new Set([id]), anchor: id }))
    setDetailPicker(picker)
    setDetailTaskId(id)
  }, [])

  // The menu acts on the selection when the task is part of it, else on the
  // task alone (which becomes the selection)
  const openMenu = useCallback((id: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    const inSel = selection.ids.has(id)
    if (!inSel) setSelection({ ids: new Set([id]), anchor: id })
    setMenu({ x, y, align, ids: inSel ? inOrder(selection, rowOrder) : [id] })
  }, [selection, rowOrder])

  const menuIds = useMemo(() => new Set(menu?.ids ?? []), [menu])
  const menuItems = useMemo(() => (menu
    ? buildTaskMenu({
        ids: menu.ids,
        tasks,
        tree,
        statuses: listStatuses.statuses,
        canAssign: !!config?.token && !!config.teamId,
        dependencyWarnings: settings.board.dependencyWarnings,
      })
    : []), [menu, tasks, tree, listStatuses.statuses, config, settings.board.dependencyWarnings])

  const runMenuAction = (action: string, ids: string[], at: { x: number; y: number }) => {
    const first = ids[0]
    if (action.startsWith('status:')) return setStatusOf(ids, action.slice('status:'.length))
    if (action.startsWith('priority:')) {
      const v = action.slice('priority:'.length)
      return setPriorityOf(ids, v === 'none' ? undefined : (Number(v) as 1 | 2 | 3 | 4))
    }
    switch (action) {
      case 'open': return openDetail(first)
      case 'rename': return startRename(first)
      case 'add-pred': return openDetail(first, 'pred')
      case 'add-succ': return openDetail(first, 'succ')
      case 'path-both':
      case 'path-up':
      case 'path-down':
        return setPathFocus({ roots: ids, dir: action.slice('path-'.length) as PathDirection })
      case 'select-path': {
        const p = dependencyPath(tasks, ids, 'both')
        return setSelection({ ids: p.ids, anchor: first })
      }
      case 'snap': {
        const days = snapAfterPredecessors(tasks, first)
        if (days) shiftTasks([first], days, `Start ${taskLabel(tree.byId.get(first))} after its predecessors`)
        return
      }
      case 'add-subtask': return handleAddSubtask(first)
      case 'indent': return indentTask(first)
      case 'outdent': return outdentTask(first)
      case 'top-level': return setTaskParent(first, undefined)
      case 'delete': return deleteTasks(ids)
      case 'assign': return setAssignFor({ ids, x: at.x, y: at.y })
      case 'shift': return setShiftFor(ids)
      case 'chain': return linkAsChain(ids)
      case 'unlink': return unlinkTasks(ids)
      case 'clear-selection': return clearSelection()
    }
  }

  // Undo / redo are off while a pull / push runs or waits for a dialog: its
  // results are about to be applied to the board as it is
  const historyBlocked = !!syncBusy || !!pendingSync
  const doUndo = useCallback(() => {
    if (historyBlocked) return
    const label = undo()
    if (label) toast.push(`Undone: ${label}`)
  }, [historyBlocked, undo, toast.push])
  undoRef.current = doUndo
  // A delete's "Undo" toast goes as soon as something else is the last step
  useEffect(() => {
    const t = deleteToastRef.current
    if (t && undoLabel !== t.label) {
      toast.dismiss(t.id)
      deleteToastRef.current = null
    }
  }, [undoLabel, toast.dismiss])
  const doRedo = useCallback(() => {
    if (historyBlocked) return
    const label = redo()
    if (label) toast.push(`Redone: ${label}`)
  }, [historyBlocked, redo, toast.push])

  // Shortcuts on the board, unless a dialog is open or a field has focus
  const dialogOpen = settingsOpen || appSettingsOpen || exportOpen || !!detailTaskId || !!newTaskDraft
    || !!pendingSync || syncLogOpen || pendingOpen || linkOpen || !!menu || !!shiftFor || !!assignFor
    || findOpen || helpOpen || switcherOpen
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (route.view !== 'board' || dialogOpen || e.defaultPrevented) return
    // The event's own target too: Enter in the rename field may already have
    // removed the field (and its focus) by the time the event gets here
    const el = document.activeElement
    if (isTypingTarget(el) || isTypingTarget(e.target as Element)) return
    const key = e.key.toLowerCase()
    const one = selection.ids.size === 1 ? [...selection.ids][0] : null
    if ((modKey(e) && !e.altKey && key === 'k') || (e.key === '/' && !modKey(e))) {
      e.preventDefault()
      setFindOpen(true)
    } else if (e.key === '?' && !modKey(e)) {
      e.preventDefault()
      setHelpOpen(true)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !modKey(e) && !e.altKey) {
      if (!rowOrder.length) return
      e.preventDefault()
      const next = stepSelection(selection, rowOrder, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
      setSelection(next)
      const focus = e.shiftKey ? lastInOrder(next, rowOrder) : [...next.ids][0]
      if (focus) revealTask(focus)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && one && !modKey(e) && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      const kids = tree.children.get(one) ?? []
      if (e.key === 'ArrowRight') {
        if (kids.length && collapsed.has(one)) toggleCollapsed(one)
        else if (kids.length && rowIdSet.has(kids[0].id)) bringIntoView(kids[0].id, false)
      } else if (kids.length && !collapsed.has(one) && rowIdSet.has(kids[0].id)) {
        toggleCollapsed(one)
      } else {
        const parent = tree.parent.get(one)
        if (parent && rowIdSet.has(parent)) bringIntoView(parent, false)
      }
    } else if (modKey(e) && !e.altKey && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      doUndo()
    } else if (modKey(e) && !e.altKey && key === 'y') {
      e.preventDefault()
      doRedo()
    } else if (!modKey(e) && !e.altKey && e.key === '\\') {
      e.preventDefault()
      setLeftHidden(!leftHidden)
    } else if (e.key === 'Escape' && !modKey(e)) {
      // A highlighted path goes first, then the selection
      if (pathFocus) {
        e.preventDefault()
        setPathFocus(null)
      } else if (selection.ids.size) {
        e.preventDefault()
        clearSelection()
      }
    } else if (key === 'p' && !modKey(e) && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      if (pathFocus) setPathFocus(null)
      else if (selection.ids.size) setPathFocus({ roots: inOrder(selection, rowOrder), dir: 'both' })
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !modKey(e) && !isActivationTarget(el)) {
      if (selection.ids.size) {
        e.preventDefault()
        deleteTasks(inOrder(selection, rowOrder))
      }
    } else if (e.key === 'Enter' && !modKey(e) && !e.shiftKey && !isActivationTarget(el)) {
      if (selection.ids.size === 1) {
        e.preventDefault()
        openDetail([...selection.ids][0])
      }
    } else if (e.key === 'F2' && !modKey(e)) {
      if (selection.ids.size === 1) {
        e.preventDefault()
        startRename([...selection.ids][0])
      }
    }
  }
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const lastRun = syncLog.runs[0]
  const clickUpReady = !!config?.token && !!board.listId
  const statusSource = useMemo(
    () => (config?.token && board.listId ? { token: config.token, listId: board.listId } : undefined),
    [config?.token, board.listId],
  )

  return (
    <PeopleContext.Provider value={people.byId}>
    <div className="app">
      <header className="app__header">
        <span className="app__logo">
          <img src="/logo-header.png" alt="" className="app__logo-img" />
          Gantt Editor
        </span>
        <div className="app__views" role="group" aria-label="View">
          <button
            type="button"
            className={`app__view-btn${route.view === 'board' ? ' app__view-btn--on' : ''}`}
            aria-pressed={route.view === 'board'}
            onClick={() => navigate({ view: 'board' })}
          >
            Board
          </button>
          <button
            type="button"
            className={`app__view-btn${route.view === 'portfolio' ? ' app__view-btn--on' : ''}`}
            aria-pressed={route.view === 'portfolio'}
            onClick={() => navigate({ view: 'portfolio', tab: route.view === 'portfolio' ? route.tab : 'overview' })}
          >
            Portfolio
          </button>
        </div>
        {route.view === 'board' && (
          <BoardSwitcher
            boards={boards.boards}
            current={board}
            connected={!!config?.token && !!config.teamId}
            workspace={workspace}
            blocked={switchBlocked}
            onSwitch={switchBoard}
            onOpenList={openListBoard}
            onNewLocal={newLocalBoard}
            onRename={renameBoard}
            onRemove={removeBoard}
            onLink={() => setLinkOpen(true)}
            onConnect={() => setSettingsOpen(true)}
            onOpenChange={setSwitcherOpen}
          />
        )}
        <div className="app__header-spacer" />
        {clickUpReady && lastRun && (
          <button
            type="button"
            className={`app__sync-report${runFailed(lastRun) ? ' app__sync-report--err' : ''}`}
            title="Open sync log"
            onClick={() => setSyncLogOpen(true)}
          >
            {runSummary(lastRun)}
          </button>
        )}
        {pending.length > 0 && (
          <button
            type="button"
            className="app__sync-report app__sync-report--pending"
            title="Tasks deleted on the board that ClickUp still has: restore them, or Push to delete them in ClickUp"
            onClick={() => setPendingOpen(true)}
          >
            🗑 {pending.length} pending deletion{pending.length === 1 ? '' : 's'}
          </button>
        )}
        {clickUpReady && (<>
          <button
            className="app__sync-btn"
            onClick={() => startSync('pull')}
            disabled={!!syncBusy}
            type="button"
            title="Pull from ClickUp: the board takes ClickUp's fields, subtasks and dependencies, adds new ClickUp tasks and drops tasks deleted there. Nothing is written to ClickUp."
          >
            {syncBusy === 'pull' ? '↓ Pulling…' : '↓ Pull'}
          </button>
          <button
            className="app__sync-btn"
            onClick={() => startSync('push')}
            disabled={!!syncBusy}
            type="button"
            title="Push to ClickUp: ClickUp takes the board's fields, subtasks and dependencies, and board-only tasks are created there. Tasks deleted on the board are deleted in ClickUp only after you confirm each one."
          >
            {syncBusy === 'push' ? '↑ Pushing…' : '↑ Push'}
          </button>
        </>)}
        {route.view === 'board' && (
          <button
            className="app__export-btn"
            onClick={() => setExportOpen(true)}
            type="button"
          >
            Export
          </button>
        )}
        <button
          className="app__settings-btn"
          onClick={() => setAppSettingsOpen(true)}
          type="button"
          title="Board colors, warnings, calendar, backlog and portfolio rules"
        >
          Settings
        </button>
        <button
          className="app__settings-btn"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          ClickUp
        </button>
      </header>
      {route.view === 'portfolio' ? (
        <PortfolioView
          pf={portfolio}
          tab={route.tab}
          onTab={tab => navigate({ view: 'portfolio', tab })}
          onOpenBoard={ref => {
            if (ref) openListBoard(ref)
            navigate({ view: 'board' })
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          cu={config}
          workspace={workspace}
          settings={settings}
        />
      ) : (<>
      {storageFull && (
        <div className="app__storage-warn" role="alert">
          Browser storage is full, so changes to this board are not saved. Remove boards you no longer
          need from the board switcher, or projects from the portfolio.
        </div>
      )}
      <div className="app__body" ref={containerRef}>
        <div
          className={`app__panel app__panel--left${leftHidden ? ' app__panel--hidden' : ''}`}
          style={{ width: leftHidden ? 0 : `${leftPct}%` }}
          aria-hidden={leftHidden || undefined}
        >
          <TaskPanel
            rows={rows}
            tree={tree}
            matchCount={filteredTasks.length}
            allTasks={tasks}
            filters={filters}
            setFilters={setFilters}
            matchMode={matchMode}
            setMatchMode={setMatchMode}
            onAdd={handleAddTask}
            onClear={() => { if (confirm('Remove all tasks?')) clearTasks() }}
            onSort={sortTasks}
            onUpdate={handleTaskUpdate}
            onMove={moveTask}
            onIndent={indentTask}
            onOutdent={outdentTask}
            onToggleCollapsed={toggleCollapsed}
            onSetAllCollapsed={setAllCollapsed}
            onOpenDetail={openDetail}
            listRef={taskListRef}
            selectedIds={selection.ids}
            onSelect={selectTask}
            onClearSelection={clearSelection}
            renameRequest={renameRequest}
            onOpenMenu={openMenu}
            menuTaskIds={menuIds}
            pathIds={path?.ids}
            lateStarts={lateStarts}
            criticalIds={critical.taskIds}
            settings={settings}
            statusSource={statusSource}
          />
        </div>
        {!leftHidden && <Divider onResize={handleResize} onCollapse={() => setLeftHidden(true)} />}
        <div className="app__panel app__panel--right" style={{ width: leftHidden ? '100%' : `${100 - leftPct}%` }}>
          <GanttPanel
            tasks={visibleTasks}
            allTasks={tasks}
            rows={rows}
            onDateChange={(id, start, end, key) => updateTask(id, { start, end }, { key })}
            onContainerReady={handleContainerReady}
            onToggleDependency={handleToggleDependency}
            focusIdRef={lhsFocusIdRef}
            criticalIds={critical.taskIds}
            criticalEdges={critical.edges}
            criticalOn={criticalOn}
            onToggleCritical={() => setCriticalOn(v => !v)}
            criticalScope={criticalScope}
            onCriticalScopeChange={setCriticalScope}
            onGeometry={setGanttGeometry}
            loadStripOn={loadStripOn}
            onToggleLoadStrip={() => setLoadStripOn(v => !v)}
            calendar={settings.calendar}
            statusColors={settings.board.statusColors}
            history={{
              undoLabel: historyBlocked ? undefined : undoLabel,
              redoLabel: historyBlocked ? undefined : redoLabel,
              onUndo: doUndo,
              onRedo: doRedo,
            }}
            leftHidden={leftHidden}
            onShowLeft={() => setLeftHidden(false)}
            selectedIds={selection.ids}
            onSelect={selectTask}
            onClearSelection={clearSelection}
            onOpenDetail={openDetail}
            settings={settings}
            onOpenMenu={(id, x, y) => openMenu(id, x, y)}
            violatedEdges={violations ?? undefined}
            onLink={(from, to) => setLink(from, to, true)}
            onFind={() => setFindOpen(true)}
            onShortcuts={() => setHelpOpen(true)}
            path={path && pathFocus ? {
              ids: path.ids,
              edges: path.edges,
              info: {
                label: pathFocus.roots.length === 1 ? taskLabel(tree.byId.get(pathFocus.roots[0])) : `${pathFocus.roots.length} tasks`,
                count: path.ids.size,
                onClear: () => setPathFocus(null),
              },
            } : undefined}
            onAddTask={handleAddTask}
            filterInfo={filters.length ? {
              shown: filteredTasks.length,
              total: boardTasks.length,
              onClear: () => setFilters([]),
            } : undefined}
          />
        </div>
      </div>
      {loadStripOn && (
        <WorkloadStrip
          tasks={filteredTasks}
          geometry={ganttGeometry}
          container={ganttContainer}
          metric={loadMetric}
          onMetric={setLoadMetric}
          onClose={() => setLoadStripOn(false)}
          settings={settings}
        />
      )}
      </>)}
      <Toasts toasts={toast.toasts} onDismiss={toast.dismiss} />
      {findOpen && route.view === 'board' && (
        <QuickFind tasks={tasks} stateOf={findState} onPick={jumpTo} onClose={() => setFindOpen(false)} />
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          align={menu.align}
          items={menuItems}
          label={menu.ids.length === 1 ? `Actions for ${tree.byId.get(menu.ids[0])?.name ?? 'task'}` : `Actions for ${menu.ids.length} tasks`}
          onAction={id => runMenuAction(id, menu.ids, menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {shiftFor && (
        <ShiftDatesDialog
          count={shiftFor.length}
          alongCount={() => shiftClosure(shiftFor).size - shiftFor.length}
          onShift={days => {
            shiftTasks(shiftFor, days, `Shift ${shiftFor.length === 1 ? taskLabel(tree.byId.get(shiftFor[0])) : `${shiftFor.length} tasks`} by ${days} day${Math.abs(days) === 1 ? '' : 's'}`)
            setShiftFor(null)
          }}
          onClose={() => setShiftFor(null)}
        />
      )}
      {assignFor && (() => {
        const ts = assignFor.ids.map(id => tree.byId.get(id)).filter((t): t is GanttTask => !!t)
        const counts = new Map<number, number>()
        for (const t of ts) for (const a of t.assignees ?? []) counts.set(a.id, (counts.get(a.id) ?? 0) + 1)
        const everyone = ts[0]?.assignees?.filter(a => counts.get(a.id) === ts.length) ?? []
        const partial = new Set([...counts].filter(([, n]) => n < ts.length).map(([id]) => id))
        return (
          <div
            className="floating-picker"
            style={{ left: Math.min(assignFor.x, window.innerWidth - 296), top: Math.min(assignFor.y, window.innerHeight - 340) }}
          >
            <AssigneePicker
              members={people.list}
              loading={people.loading}
              error={people.error}
              assigned={everyone}
              partial={partial}
              onToggle={m => toggleAssigneeOf(assignFor.ids, m)}
              onClose={() => setAssignFor(null)}
            />
          </div>
        )
      })()}
      <ClickUpSettings
        open={settingsOpen}
        config={config}
        onSave={(next) => {
          setConfig(next)
          setSettingsOpen(false)
        }}
        onDisconnect={() => {
          clearConfig()
          setSettingsOpen(false)
        }}
        onClose={() => setSettingsOpen(false)}
      />
      {linkOpen && config && (
        <LinkBoardDialog
          board={board}
          boards={boards.boards}
          workspace={workspace}
          onLink={ref => {
            boards.link(board.id, ref)
            setLinkOpen(false)
          }}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {appSettingsOpen && (
        <SettingsDialog
          settings={settings}
          knownStatuses={knownStatuses}
          knownTags={knownTags}
          onSave={next => { setSettings(next); setAppSettingsOpen(false) }}
          onClose={() => setAppSettingsOpen(false)}
        />
      )}
      {pendingSync?.stage === 'conflicts' && (
        <SyncConflictDialog
          direction={pendingSync.direction}
          conflicts={pendingSync.conflicts}
          onCancel={() => setPendingSync(null)}
          onApply={picks => {
            const s = pendingSync
            const resolution = { conflicts: s.conflicts, picks }
            if (s.deletions.length) {
              setPendingSync({ ...s, resolution, stage: 'deletions' })
              return
            }
            setPendingSync(null)
            void applySync(s.direction, s.remote, s.startedAt, s.fetchMs, resolution)
          }}
        />
      )}
      {pendingSync?.stage === 'deletions' && (
        <SyncDeleteDialog
          candidates={pendingSync.deletions}
          onCancel={() => setPendingSync(null)}
          onDone={decisions => {
            const s = pendingSync
            setPendingSync(null)
            void applySync(
              s.direction, s.remote, s.startedAt, s.fetchMs, s.resolution,
              s.deletions.map(candidate => ({ candidate, remove: decisions.get(candidate.id) ?? false })),
            )
          }}
        />
      )}
      {pendingOpen && (
        <PendingDeletionsDialog
          pending={pending}
          onRestore={id => restorePending(id)}
          onRestoreAll={() => restorePending()}
          onClose={() => setPendingOpen(false)}
        />
      )}
      {syncLogOpen && (
        <SyncLogDialog
          runs={syncLog.runs}
          onClose={() => setSyncLogOpen(false)}
          onClear={syncLog.clear}
          onOpenTask={id => { setSyncLogOpen(false); setDetailPicker(null); setDetailTaskId(id) }}
          taskIds={new Set(tasks.map(t => t.id))}
        />
      )}
      {exportOpen && (
        <ExportDialog
          source={{ kind: 'board', tasks: visibleTasks, allTasks: tasks }}
          calendar={settings.calendar}
          onClose={() => setExportOpen(false)}
        />
      )}
      {detailTaskId && (() => {
        const t = tasks.find(task => task.id === detailTaskId)
        return t ? (
          <TaskDetailPopup
            task={t}
            allTasks={tasks}
            onClose={() => { setDetailTaskId(null); setDetailPicker(null) }}
            onUpdate={patch => handleTaskUpdate(detailTaskId, patch)}
            onSetParent={parentId => setTaskParent(detailTaskId, parentId)}
            onOpenTask={id => openDetail(id)}
            onAddSubtask={() => handleAddSubtask(detailTaskId)}
            onSetSuccessor={(id, on) => setLink(detailTaskId, id, on)}
            clickupToken={config?.token}
            clickupTeamId={config?.teamId}
            clickupListId={board.listId}
            clickupSpaceId={board.spaceId}
            milestoneTag={milestoneTag}
            people={people}
            initialPicker={detailPicker}
          />
        ) : null
      })()}
      {newTaskDraft && (
        <TaskDetailPopup
          key={newTaskDraft.id}
          task={newTaskDraft}
          allTasks={tasks}
          onClose={() => setNewTaskDraft(null)}
          onUpdate={handleDraftUpdate}
          onSetParent={parentId => handleDraftUpdate({ parentId })}
          onCommit={handleCommitDraft}
          isCreateMode
          clickupToken={config?.token}
          clickupTeamId={config?.teamId}
          clickupListId={board.listId}
          clickupSpaceId={board.spaceId}
          milestoneTag={milestoneTag}
          people={people}
        />
      )}
    </div>
    </PeopleContext.Provider>
  )
}
