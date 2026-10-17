// Workload over time: how much work falls into each bucket of a timeline,
// broken down by an arbitrary key (project, assignee).
//
// Buckets are given as boundaries rather than a unit, so the same engine serves
// the portfolio charts (calendar units from unitBoundaries) and the board strip
// (frappe-gantt's own column dates).

import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { DAY_MS, DEFAULT_WORKDAYS, addDays, isWorkday, startOfDay } from './dates'
import { isDone, parentIdsOf } from './portfolio'

export type WorkloadMetric = 'count' | 'hours'

export interface WorkloadItem {
  taskId: string
  key: string
  value: number
}

export interface WorkloadBucket {
  start: Date
  end: Date // exclusive
  total: number
  byKey: Record<string, number>
  items: WorkloadItem[]
}

export interface WorkloadResult {
  buckets: WorkloadBucket[]
  keys: string[] // every key that carries load, heaviest first
  peak: number
  skippedUndated: string[] // task ids with neither date
  missingEstimate: string[] // hours metric: task ids without a time estimate
}

export interface WorkloadOptions<T extends GanttTask> {
  metric: WorkloadMetric
  // Keys a task's load is attributed to. Hours are split evenly across them;
  // the count metric gives every key a full 1.
  keysOf: (t: T) => string[]
  includeDone?: boolean
  // Days the hours metric spreads an estimate over (Date.getDay() numbers)
  workdays?: readonly number[]
}

const HOUR_MS = 3600000

// Index of the bucket containing `ms`, or -1 when outside every bucket.
function bucketIndex(bounds: number[], ms: number): number {
  if (ms < bounds[0] || ms >= bounds[bounds.length - 1]) return -1
  let lo = 0
  let hi = bounds.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bounds[mid] <= ms) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function workdaysIn(
  start: Date, endExclusive: Date, workdays: readonly number[] = DEFAULT_WORKDAYS,
): number {
  let n = 0
  for (let d = startOfDay(start); d < endExclusive; d = addDays(d, 1)) {
    if (isWorkday(d, workdays)) n++
  }
  return n
}

export function computeWorkload<T extends GanttTask>(
  tasks: T[],
  boundaries: Date[],
  opts: WorkloadOptions<T>,
): WorkloadResult {
  const result: WorkloadResult = { buckets: [], keys: [], peak: 0, skippedUndated: [], missingEstimate: [] }
  if (boundaries.length < 2) return result
  const bounds = boundaries.map(b => b.getTime())
  for (let i = 0; i < boundaries.length - 1; i++) {
    result.buckets.push({ start: boundaries[i], end: boundaries[i + 1], total: 0, byKey: {}, items: [] })
  }
  const keyTotals = new Map<string, number>()

  const eligible = tasks.filter(t => !isMilestone(t) && (opts.includeDone || !isDone(t)))
  // Tasks split into counted subtasks. The count metric skips them, so a
  // parent and its subtasks are not counted twice; hours keep a parent's own
  // estimate, since ClickUp estimates are per task, not rolled up.
  const containers = parentIdsOf(eligible)

  for (const t of eligible) {
    // A parent carries nothing of its own here: not counted, or no estimate
    if (containers.has(t.id) && (opts.metric === 'count' || !t.timeEstimate)) continue
    if (!t.start && !t.end) { result.skippedUndated.push(t.id); continue }
    if (opts.metric === 'hours' && !t.timeEstimate) { result.missingEstimate.push(t.id); continue }

    const s = startOfDay((t.start ?? t.end)!)
    let e = startOfDay((t.end ?? t.start)!)
    if (e < s) e = s
    const keys = opts.keysOf(t)
    if (keys.length === 0) continue

    // Per-bucket amount this task contributes, before the per-key split
    const perBucket = new Map<number, number>()
    if (opts.metric === 'count') {
      // Overlap test on the clipped interval: walk bucket indices, not days
      const first = Math.max(s.getTime(), bounds[0])
      const last = Math.min(e.getTime(), bounds[bounds.length - 1] - 1)
      if (first > last) continue
      const i0 = bucketIndex(bounds, first)
      const i1 = bucketIndex(bounds, last)
      for (let i = i0; i <= i1; i++) perBucket.set(i, 1)
    } else {
      const days: Date[] = []
      for (let d = s; d <= e; d = addDays(d, 1)) days.push(d)
      const work = days.filter(d => isWorkday(d, opts.workdays))
      const spread = work.length ? work : days // weekend-only task: use every day
      const perDay = t.timeEstimate! / HOUR_MS / spread.length
      for (const d of spread) {
        const i = bucketIndex(bounds, d.getTime())
        if (i >= 0) perBucket.set(i, (perBucket.get(i) ?? 0) + perDay)
      }
    }

    const share = opts.metric === 'count' ? 1 : 1 / keys.length
    for (const [i, amount] of perBucket) {
      const b = result.buckets[i]
      for (const key of keys) {
        const v = amount * share
        b.byKey[key] = (b.byKey[key] ?? 0) + v
        b.total += v
        b.items.push({ taskId: t.id, key, value: v })
        keyTotals.set(key, (keyTotals.get(key) ?? 0) + v)
      }
    }
  }

  result.peak = result.buckets.reduce((m, b) => Math.max(m, b.total), 0)
  result.keys = [...keyTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return result
}

// Bucket length in whole days, for labels and tooltips
export function bucketDays(b: { start: Date; end: Date }): number {
  return Math.round((b.end.getTime() - b.start.getTime()) / DAY_MS)
}
