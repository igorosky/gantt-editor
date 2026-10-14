import { useState, useEffect } from 'react'
import type { Assignee, GanttTask } from '../types'
import {
  indentTask as indentIn, moveTask as moveIn, outdentTask as outdentIn,
  removeSubtree, setParent, type DropPosition,
} from '../lib/tree'

const STORAGE_KEY = 'gantt-tasks'

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

export function useTasks() {
  const [tasks, setTasks] = useState<GanttTask[]>(loadFromStorage)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

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

  // Removes the task together with all its subtasks
  function removeTask(id: string) {
    setTasks(prev => removeSubtree(prev, id))
  }

  function updateTask(id: string, patch: Partial<GanttTask>) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  function moveTask(id: string, targetId: string, pos: DropPosition) {
    setTasks(prev => moveIn(prev, id, targetId, pos))
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

  function clearTasks() {
    setTasks([])
  }

  return {
    tasks, setTasks, addTask, commitTask, removeTask, updateTask,
    moveTask, setTaskParent, indentTask, outdentTask, clearTasks,
  }
}
