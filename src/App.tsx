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
import { buildTree, descendants, flattenTree } from './lib/tree'
import { daysBetween, shiftDays } from './lib/dates'
import { isActivationTarget, isTypingTarget, modKey } from './lib/keys'
import { EMPTY_SELECTION, click as clickSelection, prune as pruneSelection, type ClickMods, type Selection } from './lib/selection'
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
    tasks, setTasks, commitTask, removeTask, updateTask, moveTask, sortTasks, setTaskParent,
    indentTask, outdentTask, clearTasks, pending, restorePending, dropPending, prunePendingFor, storageFull,
    undo, redo, undoLabel, redoLabel,
  } = useTasks(board.id)
  const toast = useToasts()
  const { config, setConfig, clearConfig } = useClickUpConfig()
  const workspace = useWorkspaceTree(config?.token, config?.teamId)
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

  const handleAddTask = useCallback(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    const end = new Date(t)
    end.setDate(end.getDate() + 7)
    setNewTaskDraft({ id: crypto.randomUUID(), name: 'New task', start: t, end, progress: 0 })
  }, [])

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
    setNewTaskDraft({ id: crypto.randomUUID(), name: 'New subtask', start, end, progress: 0, parentId })
  }, [tasks])

  const handleCommitDraft = useCallback(() => {
    if (!newTaskDraft) return
    commitTask(newTaskDraft)
    if (newTaskDraft.parentId) expand(newTaskDraft.parentId)
    setNewTaskDraft(null)
  }, [newTaskDraft, commitTask, expand])

  const handleRemove = useCallback((id: string) => {
    const t = tree.byId.get(id)
    const n = descendants(id, tree).length
    if (t && n > 0 && !confirm(`Delete "${t.name}" and its ${n} subtask${n === 1 ? '' : 's'}?`)) return
    removeTask(id)
  }, [tree, removeTask])

  // Collapse every task that has subtasks, or expand everything
  const setAllCollapsed = useCallback((on: boolean) => {
    setCollapsed(on ? new Set(tree.children.keys()) : new Set())
  }, [tree])

  const handleDraftUpdate = useCallback((patch: Partial<GanttTask>) => {
    setNewTaskDraft(prev => prev ? { ...prev, ...patch } : null)
  }, [])

  const handleToggleDependency = useCallback(
    (sourceId: string, targetId: string) => {
      const target = tasks.find(t => t.id === targetId)
      if (!target) return
      const deps = target.dependencies ?? []
      updateTask(targetId, {
        dependencies: deps.includes(sourceId)
          ? deps.filter(d => d !== sourceId)
          : [...deps, sourceId],
      })
    },
    [tasks, updateTask],
  )

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

  // Rename in the row; with the task list hidden, in the details popup
  const startRename = useCallback((id: string) => {
    if (leftHidden) {
      setDetailTaskId(id)
      return
    }
    setRenameRequest(r => ({ id, n: (r?.n ?? 0) + 1 }))
  }, [leftHidden])

  const openDetail = useCallback((id: string) => {
    setSelection(s => (s.ids.size === 1 && s.ids.has(id) ? s : { ids: new Set([id]), anchor: id }))
    setDetailTaskId(id)
  }, [])

  // Undo / redo are off while a pull / push runs or waits for a dialog: its
  // results are about to be applied to the board as it is
  const historyBlocked = !!syncBusy || !!pendingSync
  const doUndo = useCallback(() => {
    if (historyBlocked) return
    const label = undo()
    if (label) toast.push(`Undone: ${label}`)
  }, [historyBlocked, undo, toast.push])
  const doRedo = useCallback(() => {
    if (historyBlocked) return
    const label = redo()
    if (label) toast.push(`Redone: ${label}`)
  }, [historyBlocked, redo, toast.push])

  // Shortcuts on the board, unless a dialog is open or a field has focus
  const dialogOpen = settingsOpen || appSettingsOpen || exportOpen || !!detailTaskId || !!newTaskDraft
    || !!pendingSync || syncLogOpen || pendingOpen || linkOpen
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (route.view !== 'board' || dialogOpen || e.defaultPrevented) return
    // The event's own target too: Enter in the rename field may already have
    // removed the field (and its focus) by the time the event gets here
    const el = document.activeElement
    if (isTypingTarget(el) || isTypingTarget(e.target as Element)) return
    const key = e.key.toLowerCase()
    if (modKey(e) && !e.altKey && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      doUndo()
    } else if (modKey(e) && !e.altKey && key === 'y') {
      e.preventDefault()
      doRedo()
    } else if (!modKey(e) && !e.altKey && e.key === '\\' && !isActivationTarget(el)) {
      e.preventDefault()
      setLeftHidden(!leftHidden)
    } else if (e.key === 'Escape' && !modKey(e)) {
      if (selection.ids.size) {
        e.preventDefault()
        clearSelection()
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
            onRemove={handleRemove}
            onUpdate={handleTaskUpdate}
            onMove={moveTask}
            onIndent={indentTask}
            onOutdent={outdentTask}
            onMakeTopLevel={id => setTaskParent(id, undefined)}
            onAddSubtask={handleAddSubtask}
            onToggleCollapsed={toggleCollapsed}
            onSetAllCollapsed={setAllCollapsed}
            onOpenDetail={openDetail}
            listRef={taskListRef}
            selectedIds={selection.ids}
            onSelect={selectTask}
            onClearSelection={clearSelection}
            renameRequest={renameRequest}
            criticalIds={critical.taskIds}
            settings={settings}
            statusSource={statusSource}
            onHide={() => setLeftHidden(true)}
          />
        </div>
        {!leftHidden && <Divider onResize={handleResize} />}
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
          onOpenTask={id => { setSyncLogOpen(false); setDetailTaskId(id) }}
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
            onClose={() => setDetailTaskId(null)}
            onUpdate={patch => handleTaskUpdate(detailTaskId, patch)}
            onSetParent={parentId => setTaskParent(detailTaskId, parentId)}
            onOpenTask={id => setDetailTaskId(id)}
            onAddSubtask={() => handleAddSubtask(detailTaskId)}
            clickupToken={config?.token}
            clickupTeamId={config?.teamId}
            clickupListId={board.listId}
            clickupSpaceId={board.spaceId}
            milestoneTag={milestoneTag}
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
        />
      )}
    </div>
  )
}
