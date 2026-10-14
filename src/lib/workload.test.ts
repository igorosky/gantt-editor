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

describe('workdaysIn', () => {
  it('counts Monday to Friday in a half-open range', () => {
    expect(workdaysIn(d(10, 12), d(10, 19))).toBe(5)
    expect(workdaysIn(d(10, 17), d(10, 19))).toBe(0)
    expect(workdaysIn(d(10, 1), d(11, 1))).toBe(22)
  })
})
