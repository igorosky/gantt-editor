import type { GanttTask } from '../types'

export interface TaskWarning {
  id: string
  message: string
}

const DOD_RE = /\bdod\b|\bdefinition of done\b/i

export function getTaskWarnings(task: GanttTask): TaskWarning[] {
  const out: TaskWarning[] = []
  const desc = task.description?.trim() ?? ''
  if (!desc) {
    out.push({
      id: 'empty-description',
      message: 'Task has no description',
    })
  } else if (!DOD_RE.test(desc)) {
    out.push({
      id: 'missing-dod',
      message: 'Description is missing Definition of Done (DoD)',
    })
  }
  return out
}
