import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { computeWorkload, workdaysIn } from './workload'

const d = (m: number, day: number) => new Date(2026, m - 1, day)
const H = 3600000

// Three Monday-based weeks: 12-18 Oct, 19-25 Oct (DST ends on the 25th), 26 Oct - 1 Nov
const WEEKS = [d(10, 12), d(10, 19), d(10, 26), d(11, 2)]

let seq = 0
function task(p: Partial<GanttTask>): GanttTask {
  return { id: `t${seq++}`, name: 'x', progress: 0, statusType: 'custom', ...p }
}

const byAssignee = (t: GanttTask) => (t.assignees ?? []).map(a => a.username)
const one = () => ['all']

describe('computeWorkload: count', () => {
  it('counts a task once in every bucket it overlaps', () => {
    const r = computeWorkload([
      task({ start: d(10, 12), end: d(10, 20) }),
      task({ start: d(10, 27), end: d(10, 28) }),
    ], WEEKS, { metric: 'count', keysOf: one })
    expect(r.buckets.map(b => b.total)).toEqual([1, 1, 1])
    expect(r.peak).toBe(1)
  })

  it('clips to the window and handles one-sided dates', () => {
    const r = computeWorkload([
      task({ start: d(9, 1), end: d(10, 13) }),   // starts before the window
      task({ end: d(10, 21) }),                     // due date only
      task({ start: d(11, 5), end: d(11, 9) }),    // after the window
    ], WEEKS, { metric: 'count', keysOf: one })
    expect(r.buckets.map(b => b.total)).toEqual([1, 1, 0])
  })

  it('gives every assignee a full count', () => {
    const r = computeWorkload([
      task({ start: d(10, 13), end: d(10, 14), assignees: [{ id: 1, username: 'A' }, { id: 2, username: 'B' }] }),
      task({ start: d(10, 13), end: d(10, 14), assignees: [{ id: 1, username: 'A' }] }),
    ], WEEKS, { metric: 'count', keysOf: byAssignee })
    expect(r.buckets[0].byKey).toEqual({ A: 2, B: 1 })
    expect(r.buckets[0].total).toBe(3)
    expect(r.keys).toEqual(['A', 'B'])
  })

  it('skips milestones, done tasks and undated tasks', () => {
    const undated = task({})
    const tasks = [
      task({ type: 'milestone', start: d(10, 13), end: d(10, 13) }),
      task({ start: d(10, 13), end: d(10, 14), statusType: 'done' }),
      undated,
    ]
    const r = computeWorkload(tasks, WEEKS, { metric: 'count', keysOf: one })
    expect(r.peak).toBe(0)
    expect(r.skippedUndated).toEqual([undated.id])
    const withDone = computeWorkload(tasks, WEEKS, { metric: 'count', keysOf: one, includeDone: true })
    expect(withDone.buckets[0].total).toBe(1)
  })
})

describe('computeWorkload: hours', () => {
  it('spreads the estimate over working days', () => {
    const r = computeWorkload([
      task({ start: d(10, 12), end: d(10, 16), timeEstimate: 10 * H }), // Mon-Fri
      task({ start: d(10, 16), end: d(10, 20), timeEstimate: 9 * H }),  // Fri, Mon, Tue
    ], WEEKS, { metric: 'hours', keysOf: one })
    expect(r.buckets[0].total).toBeCloseTo(13)
    expect(r.buckets[1].total).toBeCloseTo(6)
  })

  it('spreads over custom working days', () => {
    // Fri 16 - Sun 18 Oct with a Sun-Thu week: only Sunday is a working day
    const r = computeWorkload([task({ start: d(10, 16), end: d(10, 18), timeEstimate: 6 * H })],
      WEEKS, { metric: 'hours', keysOf: one, workdays: [0, 1, 2, 3, 4] })
    expect(r.buckets[0].total).toBeCloseTo(6)
    expect(r.buckets[0].items).toHaveLength(1)
  })

  it('uses every day for a weekend-only task', () => {
    const r = computeWorkload([task({ start: d(10, 17), end: d(10, 18), timeEstimate: 4 * H })],
      WEEKS, { metric: 'hours', keysOf: one })
    expect(r.buckets[0].total).toBeCloseTo(4)
  })

  it('splits hours across assignees and reports missing estimates', () => {
    const noEst = task({ start: d(10, 13), end: d(10, 13), assignees: [{ id: 1, username: 'A' }] })
    const r = computeWorkload([
      task({ start: d(10, 13), end: d(10, 13), timeEstimate: 6 * H,
             assignees: [{ id: 1, username: 'A' }, { id: 2, username: 'B' }] }),
      noEst,
    ], WEEKS, { metric: 'hours', keysOf: byAssignee })
    expect(r.buckets[0].byKey.A).toBeCloseTo(3)
    expect(r.buckets[0].byKey.B).toBeCloseTo(3)
    expect(r.missingEstimate).toEqual([noEst.id])
  })

  it('keeps day boundaries right across the DST change', () => {
    // Sat 24 - Tue 27 Oct: workdays are Mon 26 and Tue 27, both in week 3
    const t = task({ start: d(10, 24), end: d(10, 27), timeEstimate: 8 * H })
    const hours = computeWorkload([t], WEEKS, { metric: 'hours', keysOf: one })
    expect(hours.buckets.map(b => b.total)).toEqual([0, 0, 8])
    const count = computeWorkload([t], WEEKS, { metric: 'count', keysOf: one })
    expect(count.buckets.map(b => b.total)).toEqual([0, 1, 1])
  })

  it('accepts irregular boundaries', () => {
    const bounds = [d(10, 12), d(10, 14), d(10, 30)]
    const r = computeWorkload([task({ start: d(10, 12), end: d(10, 16), timeEstimate: 5 * H })],
      bounds, { metric: 'hours', keysOf: one })
    expect(r.buckets.map(b => b.total)).toEqual([2, 3])
    expect(r.buckets[0].items).toEqual([{ taskId: expect.any(String), key: 'all', value: 2 }])
  })
})

describe('computeWorkload: subtasks', () => {
  const parent = (p: Partial<GanttTask> = {}) =>
    task({ id: 'P', start: d(10, 12), end: d(10, 30), assignees: [{ id: 1, username: 'A' }], ...p })
  const sub = (p: Partial<GanttTask> = {}) =>
    task({ parentId: 'P', start: d(10, 13), end: d(10, 14), assignees: [{ id: 1, username: 'A' }], ...p })

  it('counts the subtasks, not their parent', () => {
    const r = computeWorkload([parent(), sub(), sub()], WEEKS, { metric: 'count', keysOf: byAssignee })
    expect(r.buckets.map(b => b.total)).toEqual([2, 0, 0])
  })

  it('counts a parent again once every subtask is out of scope', () => {
    const done = sub({ statusType: 'done' })
    expect(computeWorkload([parent(), done], WEEKS, { metric: 'count', keysOf: one })
      .buckets.map(b => b.total)).toEqual([1, 1, 1])
    // Done subtasks do not split an open parent: it keeps its own count
    expect(computeWorkload([parent(), done], WEEKS, { metric: 'count', keysOf: one, includeDone: true })
      .buckets.map(b => b.total)).toEqual([2, 1, 1])
  })

  it('never lowers anyone\'s load when done work is included', () => {
    const tasks = [
      parent(),
      sub({ statusType: 'done', assignees: [{ id: 2, username: 'B' }] }),
      task({ id: 'Q', start: d(10, 19), end: d(10, 30), statusType: 'done', assignees: [{ id: 1, username: 'A' }] }),
      task({ parentId: 'Q', start: d(10, 20), end: d(10, 21), assignees: [{ id: 2, username: 'B' }] }),
    ]
    const off = computeWorkload(tasks, WEEKS, { metric: 'count', keysOf: byAssignee })
    const on = computeWorkload(tasks, WEEKS, { metric: 'count', keysOf: byAssignee, includeDone: true })
    expect(off.buckets.map(b => b.byKey.A ?? 0)).toEqual([1, 1, 1])
    expect(on.buckets.map(b => b.byKey.A ?? 0)).toEqual([1, 1, 1])
    expect(on.buckets.map(b => b.byKey.B ?? 0)).toEqual([1, 1, 0])
    off.buckets.forEach((b, i) => {
      for (const [key, v] of Object.entries(b.byKey)) expect(on.buckets[i].byKey[key]).toBeGreaterThanOrEqual(v)
    })
  })

  it('splits a done parent by its included subtasks', () => {
    const doneParent = parent({ statusType: 'done' })
    const both = computeWorkload([doneParent, sub({ statusType: 'done' }), sub()], WEEKS,
      { metric: 'count', keysOf: one, includeDone: true })
    expect(both.buckets.map(b => b.total)).toEqual([2, 0, 0])
    const openOnly = [doneParent, sub()]
    expect(computeWorkload(openOnly, WEEKS, { metric: 'count', keysOf: one, includeDone: true }).buckets.map(b => b.total))
      .toEqual(computeWorkload(openOnly, WEEKS, { metric: 'count', keysOf: one }).buckets.map(b => b.total))
  })

  it('adds a parent\'s own estimate to its subtasks\' hours, and never flags it as missing', () => {
    const withOwn = computeWorkload([parent({ timeEstimate: 3 * H, start: d(10, 13), end: d(10, 15) }), sub({ timeEstimate: 2 * H })],
      WEEKS, { metric: 'hours', keysOf: one })
    expect(withOwn.buckets[0].total).toBeCloseTo(5)
    const none = computeWorkload([parent(), sub({ timeEstimate: 2 * H })], WEEKS, { metric: 'hours', keysOf: one })
    expect(none.missingEstimate).toEqual([])
    expect(none.buckets[0].total).toBeCloseTo(2)
  })
})

describe('workdaysIn', () => {
  it('counts Monday to Friday in a half-open range', () => {
    expect(workdaysIn(d(10, 12), d(10, 19))).toBe(5)
    expect(workdaysIn(d(10, 17), d(10, 19))).toBe(0)
    expect(workdaysIn(d(10, 1), d(11, 1))).toBe(22)
  })

  it('counts custom working days', () => {
    const sunThu = [0, 1, 2, 3, 4]
    expect(workdaysIn(d(10, 12), d(10, 19), sunThu)).toBe(5)
    expect(workdaysIn(d(10, 16), d(10, 19), sunThu)).toBe(1) // Fri, Sat, Sun
  })
})
