import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { draftChanged } from './draft'

const D = (d: number) => new Date(2026, 10, d)

const draft: GanttTask = { id: 'n', name: 'New task', start: D(6), end: D(13), progress: 0 }

describe('draftChanged', () => {
  it('is false for an untouched draft', () => {
    expect(draftChanged(draft, { ...draft })).toBe(false)
    // same dates in new objects, padding around the name, empty description
    expect(draftChanged(draft, { ...draft, start: D(6), end: D(13), name: ' New task ', description: '  ' })).toBe(false)
    // empty lists and explicit undefined equal the absent fields
    expect(draftChanged(draft, { ...draft, tags: [], assignees: [], dependencies: [], priority: undefined })).toBe(false)
  })

  it('notices every field the popup can set', () => {
    const changes: Partial<GanttTask>[] = [
      { name: 'Login page' },
      { type: 'milestone' },
      { start: D(7) },
      { end: undefined },
      { status: 'in progress', statusColor: '#4194f6' },
      { priority: 2 },
      { assignees: [{ id: 1, username: 'ala' }] },
      { tags: [{ name: 'web' }] },
      { description: 'DoD: done' },
      { dependencies: ['a'] },
      { parentId: 'p' },
    ]
    for (const patch of changes) expect(draftChanged(draft, { ...draft, ...patch })).toBe(true)
  })

  it('counts a reverted change as unchanged', () => {
    const edited = { ...draft, priority: 1 as const, tags: [{ name: 'b' }, { name: 'a' }] }
    expect(draftChanged(draft, edited)).toBe(true)
    expect(draftChanged(draft, { ...edited, priority: undefined, tags: [] })).toBe(false)
    // order of tags does not matter
    expect(draftChanged(edited, { ...edited, tags: [{ name: 'a' }, { name: 'b' }] })).toBe(false)
  })

  it('treats a task without a type as a task', () => {
    expect(draftChanged(draft, { ...draft, type: 'task' })).toBe(false)
  })
})
