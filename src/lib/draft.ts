// Whether a new-task draft holds anything the user entered, so closing it
// without creating the task should ask first. Pure.

import type { GanttTask } from '../types'

// Every field the create popup can set, in a form where equal content gives an
// equal string: trimmed name, dates by time, empty description = none, ids
// sorted. Reverting a change therefore counts as unchanged.
function snapshot(t: GanttTask): string {
  return JSON.stringify({
    name: t.name.trim(),
    type: t.type ?? 'task',
    start: t.start?.getTime() ?? null,
    end: t.end?.getTime() ?? null,
    status: t.status ?? null,
    priority: t.priority ?? null,
    assignees: (t.assignees ?? []).map(a => `${a.id}:${a.username}`).sort(),
    tags: (t.tags ?? []).map(tag => tag.name).sort(),
    description: t.description?.trim() || null,
    dependencies: [...(t.dependencies ?? [])].sort(),
    parentId: t.parentId ?? null,
  })
}

export function draftChanged(initial: GanttTask, current: GanttTask): boolean {
  return snapshot(initial) !== snapshot(current)
}
