import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTasks } from './hooks/useTasks'
import { useClickUpConfig } from './hooks/useClickUpConfig'
import { TaskPanel } from './components/TaskPanel'
import { GanttPanel } from './components/GanttPanel'
import { Divider } from './components/Divider'
import { ClickUpSettings } from './components/ClickUpSettings'
import { TaskDetailPopup } from './components/TaskDetailPopup'
import { ExportDialog } from './components/ExportDialog'
import { WorkloadStrip } from './components/WorkloadStrip'
import { PortfolioView } from './components/portfolio/PortfolioView'
import type { GanttGeometry } from './components/GanttPanel'
import { useHashRoute } from './hooks/useHashRoute'
import { usePortfolio } from './hooks/usePortfolio'
import type { WorkloadMetric } from './lib/workload'
import { applyFilters, getAllSuccessors } from './utils'
import { syncWithClickUp } from './lib/sync'
import { EMPTY_CRITICAL, computeCriticalPath } from './lib/criticalPath'
import type { CriticalScope, Filter, GanttTask, SyncReport } from './types'
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

export default function App() {
  const { tasks, setTasks, commitTask, removeTask, updateTask, reorderTask, clearTasks } = useTasks()
  const { config, setConfig } = useClickUpConfig()
  const [leftPct, setLeftPct] = useState(DEFAULT_PCT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [newTaskDraft, setNewTaskDraft] = useState<GanttTask | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastReport, setLastReport] = useState<SyncReport | null>(null)
  const [filters, setFilters] = useState<Filter[]>([])
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all')
  const filteredTasks = useMemo(() => applyFilters(tasks, filters, matchMode), [tasks, filters, matchMode])
  const [criticalOn, setCriticalOn] = useState(() => loadCritical().on)
  const [criticalScope, setCriticalScope] = useState<CriticalScope>(() => loadCritical().scope)
  const critical = useMemo(
    () => (criticalOn
      ? computeCriticalPath(criticalScope === 'view' ? filteredTasks : tasks)
      : EMPTY_CRITICAL),
    [criticalOn, criticalScope, tasks, filteredTasks],
  )
  const [route, navigate] = useHashRoute()
  const portfolio = usePortfolio(tasks, config)
  const [loadStripOn, setLoadStripOn] = useState(() => loadStripPrefs().on)
  const [loadMetric, setLoadMetric] = useState<WorkloadMetric>(() => loadStripPrefs().metric)
  const [ganttGeometry, setGanttGeometry] = useState<GanttGeometry | null>(null)
  const [ganttContainer, setGanttContainer] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const taskListRef = useRef<HTMLDivElement>(null)
  const isSyncingRef = useRef(false)
  const scrollCleanupRef = useRef<(() => void) | null>(null)
  const lhsFocusIdRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(CRITICAL_KEY, JSON.stringify({ on: criticalOn, scope: criticalScope }))
    } catch { /* quota */ }
  }, [criticalOn, criticalScope])

  useEffect(() => {
    try {
      localStorage.setItem(LOAD_STRIP_KEY, JSON.stringify({ on: loadStripOn, metric: loadMetric }))
    } catch { /* quota */ }
  }, [loadStripOn, loadMetric])

  const onSync = useCallback(async () => {
    if (!config?.token || !config.listId) return
    setSyncing(true)
    const t0 = performance.now()
    try {
      const report = await syncWithClickUp(config, tasks, setTasks)
      setLastReport(report)
      setConfig({ ...config, lastSyncAt: new Date().toISOString() })
    } catch (e) {
      setLastReport({
        added: 0,
        updatedFromRemote: 0,
        pushedToRemote: 0,
        deletedLocal: 0,
        createdRemote: 0,
        depsAdded: 0,
        depsAddedFromRemote: 0,
        errors: [String(e)],
        durationMs: performance.now() - t0,
      })
    } finally {
      setSyncing(false)
    }
  }, [config, tasks, setTasks, setConfig])

  const handleResize = useCallback((deltaX: number) => {
    const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth
    setLeftPct(prev => {
      const newPct = prev + (deltaX / containerWidth) * 100
      return Math.min(MAX_PCT, Math.max(MIN_PCT, newPct))
    })
  }, [])

  const handleTaskUpdate = useCallback(
    (id: string, patch: Partial<GanttTask>) => {
      lhsFocusIdRef.current = id
      updateTask(id, patch)
      if ('end' in patch && patch.end !== undefined) {
        const prev = tasks.find(t => t.id === id)
        if (prev && prev.end !== undefined) {
          const delta = patch.end.getTime() - prev.end.getTime()
          if (delta !== 0) {
            for (const sid of getAllSuccessors(id, tasks)) {
              const s = tasks.find(t => t.id === sid)
              if (s && s.start && s.end) {
                updateTask(sid, {
                  start: new Date(s.start.getTime() + delta),
                  end: new Date(s.end.getTime() + delta),
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

  const reportSummary = (r: SyncReport): string =>
    r.errors.length === 0
      ? `+${r.added} from CU · ${r.createdRemote} → CU · ${r.updatedFromRemote} pulled · ${r.pushedToRemote} pushed · ${r.deletedLocal} removed · ${r.depsAdded + r.depsAddedFromRemote} deps`
      : `Sync errors: ${r.errors[0]}${r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''}`

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
        <div className="app__header-spacer" />
        {lastReport && (
          <span
            className={`app__sync-report${lastReport.errors.length ? ' app__sync-report--err' : ''}`}
            title={lastReport.errors.join('\n') || undefined}
          >
            {reportSummary(lastReport)}
          </span>
        )}
        {config?.lastSyncAt && (
          <span className="app__sync-stamp">
            Last sync: {new Date(config.lastSyncAt).toLocaleTimeString()}
          </span>
        )}
        {config?.token && config.listId && (
          <button
            className="app__sync-btn"
            onClick={onSync}
            disabled={syncing}
            type="button"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
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
          onOpenBoard={() => navigate({ view: 'board' })}
          onOpenSettings={() => setSettingsOpen(true)}
          cu={config}
        />
      ) : (<>
      <div className="app__body" ref={containerRef}>
        <div className="app__panel app__panel--left" style={{ width: `${leftPct}%` }}>
          <TaskPanel
            tasks={filteredTasks}
            allTasks={tasks}
            filters={filters}
            setFilters={setFilters}
            matchMode={matchMode}
            setMatchMode={setMatchMode}
            onAdd={handleAddTask}
            onClear={() => { if (confirm('Remove all tasks?')) clearTasks() }}
            onRemove={removeTask}
            onUpdate={handleTaskUpdate}
            onReorder={reorderTask}
            onOpenDetail={(id) => setDetailTaskId(id)}
            listRef={taskListRef}
            criticalIds={critical.taskIds}
          />
        </div>
        <Divider onResize={handleResize} />
        <div className="app__panel app__panel--right" style={{ width: `${100 - leftPct}%` }}>
          <GanttPanel
            tasks={filteredTasks}
            onDateChange={(id, start, end) => updateTask(id, { start, end })}
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
        />
      )}
      </>)}
      <ClickUpSettings
        open={settingsOpen}
        config={config}
        onSave={(next) => {
          setConfig(next)
          setSettingsOpen(false)
        }}
        onClose={() => setSettingsOpen(false)}
      />
      {exportOpen && (
        <ExportDialog
          tasks={filteredTasks}
          allTasks={tasks}
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
            clickupToken={config?.token}
            clickupTeamId={config?.teamId}
            clickupListId={config?.listId}
            clickupSpaceId={config?.spaceId}
          />
        ) : null
      })()}
      {newTaskDraft && (
        <TaskDetailPopup
          task={newTaskDraft}
          allTasks={tasks}
          onClose={() => setNewTaskDraft(null)}
          onUpdate={handleDraftUpdate}
          onCommit={() => { commitTask(newTaskDraft); setNewTaskDraft(null) }}
          isCreateMode
          clickupToken={config?.token}
          clickupTeamId={config?.teamId}
          clickupListId={config?.listId}
          clickupSpaceId={config?.spaceId}
        />
      )}
    </div>
  )
}
