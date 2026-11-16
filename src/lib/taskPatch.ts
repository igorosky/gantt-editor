// Whether a patch changes a task, and how an edit is named in the undo
// history. Pure.

import type { GanttTask } from '../types'

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (a === b) return true
  if ((typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }
  return false
}

// True when applying `patch` would change any field of `t`
export function changesTask(t: GanttTask, patch: Partial<GanttTask>): boolean {
  return (Object.keys(patch) as Array<keyof GanttTask>).some(k => !same(t[k], patch[k]))
}

const quoted = (name: string) => `"${name.length > 40 ? `${name.slice(0, 39)}…` : name}"`

// The undo label of an edit to one task
export function editLabel(t: GanttTask | undefined, patch: Partial<GanttTask>): string {
  const name = t ? quoted(t.name) : 'task'
  if ('name' in patch) return `Rename ${name}`
  if ('start' in patch || 'end' in patch) return `Change dates of ${name}`
  if ('dependencies' in patch) return `Change links of ${name}`
  if ('parentId' in patch) return `Move ${name}`
  if ('status' in patch) return `Set status of ${name}`
  if ('priority' in patch) return `Set priority of ${name}`
  if ('assignees' in patch) return `Change assignees of ${name}`
  if ('tags' in patch) return `Change tags of ${name}`
  if ('type' in patch) return `Change type of ${name}`
  if ('description' in patch) return `Edit description of ${name}`
  return `Edit ${name}`
}

export const taskLabel = (t: GanttTask | undefined): string => (t ? quoted(t.name) : 'task')
