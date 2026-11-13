import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { changesTask, editLabel } from './taskPatch'

const t: GanttTask = {
  id: 'a', name: 'Alpha', progress: 0,
  start: new Date('2026-03-02T00:00:00'), end: new Date('2026-03-06T23:59:59'),
  dependencies: ['x'], assignees: [{ id: 1, username: 'u' }],
}

describe('changesTask', () => {
  it('sees no change for equal values, dates by time, arrays by content', () => {
    expect(changesTask(t, { name: 'Alpha' })).toBe(false)
    expect(changesTask(t, { start: new Date('2026-03-02T00:00:00') })).toBe(false)
    expect(changesTask(t, { dependencies: ['x'], assignees: [{ id: 1, username: 'u' }] })).toBe(false)
    expect(changesTask(t, {})).toBe(false)
  })

  it('sees real changes', () => {
    expect(changesTask(t, { name: 'Beta' })).toBe(true)
    expect(changesTask(t, { end: new Date('2026-03-06T00:00:00') })).toBe(true)
    expect(changesTask(t, { start: undefined })).toBe(true)
    expect(changesTask(t, { dependencies: [] })).toBe(true)
    expect(changesTask(t, { description: '' })).toBe(true)
  })
})

describe('editLabel', () => {
  it('names the kind of edit and the task', () => {
    expect(editLabel(t, { name: 'B' })).toBe('Rename "Alpha"')
    expect(editLabel(t, { end: new Date() })).toBe('Change dates of "Alpha"')
    expect(editLabel(t, { dependencies: [] })).toBe('Change links of "Alpha"')
    expect(editLabel(undefined, { progress: 1 })).toBe('Edit task')
    expect(editLabel({ ...t, name: 'x'.repeat(60) }, {}).length).toBeLessThan(50)
  })
})
