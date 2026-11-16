import { useCallback, useState, useEffect, type SetStateAction } from 'react'
import type { Assignee, GanttTask, PendingDeletion } from '../types'
import type { RemoteTask } from '../lib/clickup'
import { boardKey } from '../lib/boards'
import { prunePending, recordDeletion, restoreDeletion } from '../lib/deletions'
import { emptyHistory, record, redo as redoStep, undo as undoStep, type History } from '../lib/history'
import { changesTask, editLabel, taskLabel } from '../lib/taskPatch'
import {
  indentTask as indentIn, moveTask as moveIn, outdentTask as outdentIn,
  removeSubtree, setParent, sortTasks as sortIn, type DropPosition,
} from '../lib/tree'

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// One task parsed from JSON: ISO dates back to Date, old string assignees
// wrapped with the -1 sentinel id.
export function reviveTask<T extends GanttTask = GanttTask>(t: Record<string, unknown>): T {
  return {
    ...(t as Omit<T, 'start' | 'end' | 'assignees'>),
    start: t.start ? new Date(t.start as string) : undefined,
    end: t.end ? new Date(t.end as string) : undefined,
    assignees: Array.isArray(t.assignees)
      ? (t.assignees as unknown[]).map((a): Assignee =>
          typeof a === 'string' ? { id: -1, username: a } : (a as Assignee)
        )
      : undefined,
  } as T
}

export function deserialize(raw: string): GanttTask[] {
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
  return parsed.map(t => reviveTask(t))
}

// A board's tasks; the example task when the board has never saved any
// (boards created in the app save [] right away, so that is a fresh install)
export function loadTasks(boardId: string): GanttTask[] {
  try {
    const raw = localStorage.getItem(boardKey('tasks', boardId))
    if (raw) return deserialize(raw)
  } catch {
    // corrupted storage — start fresh
  }
  return [
    {
      id: crypto.randomUUID(),
      name: 'Example task',
      start: today(),
      end: addDays(today(), 7),
      progress: 0,
    },
  ]
}

export function loadPending(boardId: string): PendingDeletion[] {
  try {
    const raw = localStorage.getItem(boardKey('pending', boardId))
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && Array.isArray((d as PendingDeletion).tasks))
          .map(d => ({ ...(d as unknown as PendingDeletion), tasks: (d.tasks as Array<Record<string, unknown>>).map(t => reviveTask(t)) }))
      }
    }
  } catch { /* malformed entry */ }
  return []
}

interface Snapshot {
  tasks: GanttTask[]
  // Linked tasks deleted on the board, until Push settles them or they are restored
  pending: PendingDeletion[]
}

interface BoardData extends Snapshot {
  boardId: string
  // Undo / redo of board edits; in memory only, emptied by a pull / push
  history: History<Snapshot>
}

const loadBoard = (boardId: string): BoardData =>
  ({ boardId, tasks: loadTasks(boardId), pending: loadPending(boardId), history: emptyHistory() })

const apply = <T,>(next: SetStateAction<T>, prev: T): T =>
  (typeof next === 'function' ? (next as (p: T) => T)(prev) : next)

// Edits made in one event (one JS task) share a key, so they undo together:
// e.g. a date change and the successors it shifts
let tick: string | null = null
let tickCount = 0
function tickKey(): string {
  if (!tick) {
    tick = `tick:${++tickCount}`
    queueMicrotask(() => { tick = null })
  }
  return tick
}

export interface EditOptions {
  label?: string // undo label (default: derived from the patch)
  key?: string // edits with the same key as the last one undo with it (a drag gesture)
}

// The tasks of one board. Switching boardId loads the other board's data in
// the same render, and the data carries its own board id, so one board's
// tasks are never saved under another board's key.
//
// Every edit function records an undo step; setTasks / dropPending /
// prunePendingFor are the sync's own writes and clear the history instead,
// so an undo can never take back a clickupId a push just stored.
export function useTasks(boardId: string) {
  const [data, setData] = useState<BoardData>(() => loadBoard(boardId))
  const [storageFull, setStorageFull] = useState(false)
  let current = data
  if (data.boardId !== boardId) {
    current = loadBoard(boardId)
    setData(current)
  }
  const { tasks, pending, history } = current

  const setTasks = useCallback((next: SetStateAction<GanttTask[]>) => {
    setData(d => ({ ...d, tasks: apply(next, d.tasks), history: emptyHistory() }))
  }, [])

  const setPending = useCallback((next: SetStateAction<PendingDeletion[]>) => {
    setData(d => {
      const p = apply(next, d.pending)
      return p === d.pending ? d : { ...d, pending: p, history: emptyHistory() }
    })
  }, [])

  // An edit: `fn` maps the board to its next state; returning the same
  // arrays records nothing (no empty undo steps)
  const mutate = useCallback((fn: (s: Snapshot) => Snapshot, label: string, key?: string) => {
    const k = key ?? tickKey()
    setData(d => {
      const prev = { tasks: d.tasks, pending: d.pending }
      const next = fn(prev)
      if (next.tasks === d.tasks && next.pending === d.pending) return d
      return { ...d, tasks: next.tasks, pending: next.pending, history: record(d.history, prev, label, k) }
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(boardKey('tasks', data.boardId), JSON.stringify(data.tasks))
      setStorageFull(false)
    } catch {
      setStorageFull(true)
    }
  }, [data.boardId, data.tasks])

  useEffect(() => {
    try {
      localStorage.setItem(boardKey('pending', data.boardId), JSON.stringify(data.pending))
    } catch { /* quota */ }
  }, [data.boardId, data.pending])

  const byId = (id: string) => tasks.find(t => t.id === id)

  // Adds a new task; `successors` get it as a predecessor in the same step
  function commitTask(t: GanttTask, successors: string[] = []) {
    const after = new Set(successors)
    mutate(s => ({
      ...s,
      tasks: [
        ...s.tasks.map(x => (after.has(x.id) && !(x.dependencies ?? []).includes(t.id)
          ? { ...x, dependencies: [...(x.dependencies ?? []), t.id] }
          : x)),
        t,
      ],
    }), `Create ${taskLabel(t)}`)
  }

  // Removes the tasks together with all their subtasks. Linked ones become
  // a pending deletion, which the next push asks about.
  function removeTasks(ids: string[], label?: string) {
    const now = new Date()
    mutate(s => {
      let { tasks: ts, pending: p } = s
      for (const id of ids) {
        if (!ts.some(t => t.id === id)) continue // already gone with a parent
        p = recordDeletion(p, ts, id, now)
        ts = removeSubtree(ts, id)
      }
      return { tasks: ts, pending: p }
    }, label ?? (ids.length === 1 ? `Delete ${taskLabel(byId(ids[0]))}` : `Delete ${ids.length} tasks`))
  }

  function removeTask(id: string) {
    removeTasks([id])
  }

  // Puts a pending deletion back on the board; all of them newest first, so
  // every one lands where it was
  function restorePending(id?: string) {
    mutate(s => {
      const list = id === undefined ? [...s.pending].reverse() : s.pending.filter(d => d.id === id)
      if (!list.length) return s
      const done = new Set(list.map(d => d.id))
      return { tasks: list.reduce(restoreDeletion, s.tasks), pending: s.pending.filter(d => !done.has(d.id)) }
    }, id === undefined ? 'Restore deleted tasks' : 'Restore deleted task')
  }

  // Stable, since the sync callbacks depend on them
  const dropPending = useCallback((ids: Iterable<string>) => {
    const gone = new Set(ids)
    if (gone.size) setPending(p => p.filter(d => !gone.has(d.id)))
  }, [setPending])

  // Drops pending deletions with nothing left in the fetched ClickUp list
  const prunePendingFor = useCallback((remote: RemoteTask[]) => {
    setPending(p => {
      const next = prunePending(p, remote)
      return next.length === p.length ? p : next
    })
  }, [setPending])

  function updateTask(id: string, patch: Partial<GanttTask>, opts: EditOptions = {}) {
    mutate(s => {
      const cur = s.tasks.find(t => t.id === id)
      if (!cur || !changesTask(cur, patch)) return s
      return { ...s, tasks: s.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) }
    }, opts.label ?? editLabel(byId(id), patch), opts.key)
  }

  // Several tasks in one undo step
  function updateTasks(patches: ReadonlyMap<string, Partial<GanttTask>>, label: string, key?: string) {
    mutate(s => {
      let changed = false
      const next = s.tasks.map(t => {
        const p = patches.get(t.id)
        if (!p || !changesTask(t, p)) return t
        changed = true
        return { ...t, ...p }
      })
      return changed ? { ...s, tasks: next } : s
    }, label, key)
  }

  const changed = (prev: GanttTask[], next: GanttTask[]) =>
    next.length !== prev.length || next.some((t, i) => t !== prev[i])

  // A pure rewrite of the array; recorded only when it changed something
  function rewrite(fn: (ts: GanttTask[]) => GanttTask[], label: string) {
    mutate(s => {
      const next = fn(s.tasks)
      return changed(s.tasks, next) ? { ...s, tasks: next } : s
    }, label)
  }

  function moveTask(id: string, targetId: string, pos: DropPosition) {
    rewrite(ts => moveIn(ts, id, targetId, pos), `Move ${taskLabel(byId(id))}`)
  }

  // Rewrites the saved order, every sibling level sorted (start, due,
  // priority, name)
  function sortTasks() {
    rewrite(ts => sortIn(ts), 'Sort tasks')
  }

  function setTaskParent(id: string, parentId: string | undefined) {
    rewrite(ts => setParent(ts, id, parentId), `Move ${taskLabel(byId(id))}`)
  }

  function indentTask(id: string) {
    rewrite(ts => indentIn(ts, id), `Indent ${taskLabel(byId(id))}`)
  }

  function outdentTask(id: string) {
    rewrite(ts => outdentIn(ts, id), `Outdent ${taskLabel(byId(id))}`)
  }

  // A local reset: nothing is queued for deletion in ClickUp
  function clearTasks() {
    mutate(s => (s.tasks.length || s.pending.length ? { tasks: [], pending: [] } : s), 'Clear all tasks')
  }

  // Back to before the last edit; returns its label (null: nothing to undo)
  function undo(): string | null {
    const label = history.past[history.past.length - 1]?.label ?? null
    if (label === null) return null
    setData(d => {
      const step = undoStep(d.history, { tasks: d.tasks, pending: d.pending })
      return step ? { ...d, ...step.state, history: step.history } : d
    })
    return label
  }

  function redo(): string | null {
    const label = history.future[history.future.length - 1]?.label ?? null
    if (label === null) return null
    setData(d => {
      const step = redoStep(d.history, { tasks: d.tasks, pending: d.pending })
      return step ? { ...d, ...step.state, history: step.history } : d
    })
    return label
  }

  return {
    tasks, setTasks, commitTask, removeTask, removeTasks, updateTask, updateTasks,
    moveTask, sortTasks, setTaskParent, indentTask, outdentTask, clearTasks,
    pending, restorePending, dropPending, prunePendingFor, storageFull,
    undo, redo,
    undoLabel: history.past[history.past.length - 1]?.label,
    redoLabel: history.future[history.future.length - 1]?.label,
  }
}
