import { useCallback, useState, useEffect } from 'react'
import type { Assignee, GanttTask, PendingDeletion } from '../types'
import type { RemoteTask } from '../lib/clickup'
import { prunePending, recordDeletion, restoreDeletion } from '../lib/deletions'
import {
  indentTask as indentIn, moveTask as moveIn, outdentTask as outdentIn,
  removeSubtree, setParent, sortByDate, type DateSortKey, type DropPosition, type SortDir,
} from '../lib/tree'

const STORAGE_KEY = 'gantt-tasks'
const PENDING_KEY = 'gantt-pending-deletions'

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

function loadFromStorage(): GanttTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

function loadPending(): PendingDeletion[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
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

export function useTasks() {
  const [tasks, setTasks] = useState<GanttTask[]>(loadFromStorage)
  // Linked tasks deleted on the board, until Push settles them or they are restored
  const [pending, setPending] = useState<PendingDeletion[]>(loadPending)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    } catch { /* quota */ }
  }, [pending])

  function addTask() {
    const t = today()
    setTasks(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: 'New task',
        start: t,
        end: addDays(t, 7),
        progress: 0,
      },
    ])
  }

  function commitTask(t: GanttTask) {
    setTasks(prev => [...prev, t])
  }

  // Removes the task together with all its subtasks. Linked ones become a
  // pending deletion, which the next push asks about.
  function removeTask(id: string) {
    const now = new Date()
    setPending(p => recordDeletion(p, tasks, id, now))
    setTasks(prev => removeSubtree(prev, id))
  }

  // Puts a pending deletion back on the board; all of them newest first, so
  // every one lands where it was
  function restorePending(id?: string) {
    const list = id === undefined ? [...pending].reverse() : pending.filter(d => d.id === id)
    if (!list.length) return
    setTasks(prev => list.reduce(restoreDeletion, prev))
    const done = new Set(list.map(d => d.id))
    setPending(p => p.filter(d => !done.has(d.id)))
  }

  // Stable, since the sync callbacks depend on them
  const dropPending = useCallback((ids: Iterable<string>) => {
    const gone = new Set(ids)
    if (gone.size) setPending(p => p.filter(d => !gone.has(d.id)))
  }, [])

  // Drops pending deletions with nothing left in the fetched ClickUp list
  const prunePendingFor = useCallback((remote: RemoteTask[]) => {
    setPending(p => prunePending(p, remote))
  }, [])

  function updateTask(id: string, patch: Partial<GanttTask>) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  function moveTask(id: string, targetId: string, pos: DropPosition) {
    setTasks(prev => moveIn(prev, id, targetId, pos))
  }

  // Rewrites the saved order, every sibling level sorted by the date
  function sortTasks(key: DateSortKey, dir: SortDir) {
    setTasks(prev => sortByDate(prev, key, dir))
  }

  function setTaskParent(id: string, parentId: string | undefined) {
    setTasks(prev => setParent(prev, id, parentId))
  }

  function indentTask(id: string) {
    setTasks(prev => indentIn(prev, id))
  }

  function outdentTask(id: string) {
    setTasks(prev => outdentIn(prev, id))
  }

  // A local reset: nothing is queued for deletion in ClickUp
  function clearTasks() {
    setTasks([])
    setPending([])
  }

  return {
    tasks, setTasks, addTask, commitTask, removeTask, updateTask,
    moveTask, sortTasks, setTaskParent, indentTask, outdentTask, clearTasks,
    pending, restorePending, dropPending, prunePendingFor,
  }
}
