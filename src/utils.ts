import type { Filter, GanttTask, TaskType } from './types'
import { isOverdue } from './lib/portfolio'

export const isMilestone = (t: GanttTask): boolean => t.type === 'milestone'

// A milestone holds a single date in both start and end. Converting a dated
// task keeps its due date; converting back leaves it as a one-day task.
export function typeChangePatch(t: GanttTask, next: TaskType): Partial<GanttTask> {
  if (next !== 'milestone') return { type: 'task' }
  const d = t.end ?? t.start
  return { type: 'milestone', start: d, end: d }
}

export function taskMatchesFilter(task: GanttTask, f: Filter): boolean {
  switch (f.type) {
    case 'status': {
      const set = new Set(f.value as string[])
      const hit = task.status != null && set.has(task.status)
      return f.op === 'is' ? !!hit : !hit
    }
    case 'tag': {
      const set = new Set(f.value as string[])
      const names = (task.tags ?? []).map(t => t.name)
      const hit = names.some(n => set.has(n))
      return f.op === 'has' ? hit : !hit
    }
    case 'assignee': {
      const set = new Set(f.value as number[])
      const ids = (task.assignees ?? []).map(a => a.id)
      const hit = ids.some(id => set.has(id))
      return f.op === 'is' ? hit : !hit
    }
    case 'priority': {
      const set = new Set(f.value as number[])
      const hit = task.priority != null && set.has(task.priority)
      return f.op === 'is' ? !!hit : !hit
    }
    case 'name': {
      const q = ((f.value as string) ?? '').trim().toLowerCase()
      if (!q) return true
      const match = task.name.toLowerCase().includes(q)
      return f.op === 'notContains' ? !match : match
    }
    case 'due': {
      if (!f.value || !task.end) return false
      const d = new Date(f.value as string).getTime()
      const t = task.end.getTime()
      return f.op === 'before' ? t <= d : t >= d
    }
    case 'start': {
      if (!f.value || !task.start) return false
      const d = new Date(f.value as string).getTime()
      const t = task.start.getTime()
      return f.op === 'before' ? t <= d : t >= d
    }
    case 'deps': {
      const has = (task.dependencies?.length ?? 0) > 0
      return f.op === 'has' ? has : !has
    }
    case 'unscheduled':
      return !task.start || !task.end
    case 'overdue':
      return isOverdue(task, new Date())
  }
}

export function applyFilters(
  tasks: GanttTask[],
  filters: Filter[],
  matchMode: 'all' | 'any',
): GanttTask[] {
  if (filters.length === 0) return tasks
  if (matchMode === 'any') return tasks.filter(t => filters.some(f => taskMatchesFilter(t, f)))
  return tasks.filter(t => filters.every(f => taskMatchesFilter(t, f)))
}

export function getAllSuccessors(taskId: string, allTasks: GanttTask[]): string[] {
  const result: string[] = []
  const queue = [taskId]
  const visited = new Set<string>([taskId])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const task of allTasks) {
      if (task.dependencies?.includes(current) && !visited.has(task.id)) {
        visited.add(task.id)
        result.push(task.id)
        queue.push(task.id)
      }
    }
  }
  return result
}
