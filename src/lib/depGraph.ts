// Dependency graph questions the board asks: the chains a task lies on, which
// links may be added, and which links have a successor starting too early.
// Pure. An edge u -> v means v depends on u (u is in v.dependencies).

import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { edgeKey } from './criticalPath'
import { daysBetween } from './dates'

export interface DepIndex {
  byId: Map<string, GanttTask>
  preds: Map<string, string[]> // id -> its predecessors that exist
  succs: Map<string, string[]> // id -> tasks depending on it
}

const indexCache = new WeakMap<readonly GanttTask[], DepIndex>()

// One index per task array (memoized on its identity)
export function depIndex(tasks: readonly GanttTask[]): DepIndex {
  const hit = indexCache.get(tasks)
  if (hit) return hit
  const byId = new Map(tasks.map(t => [t.id, t]))
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const t of tasks) {
    const ps = [...new Set(t.dependencies ?? [])].filter(d => d !== t.id && byId.has(d))
    preds.set(t.id, ps)
    for (const p of ps) {
      const list = succs.get(p)
      if (list) list.push(t.id)
      else succs.set(p, [t.id])
    }
  }
  const idx = { byId, preds, succs }
  indexCache.set(tasks, idx)
  return idx
}

// Every task reachable from `roots` along `next`, roots excluded unless reached
// again through a loop. Cycle-safe.
function reach(roots: Iterable<string>, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const queue = [...roots]
  const start = new Set(queue)
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of next.get(cur) ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      if (!start.has(n)) queue.push(n)
    }
  }
  return seen
}

export const allPredecessors = (tasks: readonly GanttTask[], roots: Iterable<string>): Set<string> =>
  reach(roots, depIndex(tasks).preds)

export const allSuccessors = (tasks: readonly GanttTask[], roots: Iterable<string>): Set<string> =>
  reach(roots, depIndex(tasks).succs)

export type PathDirection = 'both' | 'up' | 'down'

export interface DepPath {
  ids: Set<string>
  edges: Set<string> // edgeKey(from, to)
}

// The chains the roots lie on: every transitive predecessor (up), successor
// (down) or both, with the roots. An edge is on the path when it leads into a
// root or into its upstream, or out of a root or its downstream; an edge that
// bypasses the roots (a -> c around a -> r -> c) is not.
export function dependencyPath(tasks: readonly GanttTask[], roots: Iterable<string>, dir: PathDirection = 'both'): DepPath {
  const idx = depIndex(tasks)
  const rootSet = new Set([...roots].filter(id => idx.byId.has(id)))
  const up = dir === 'down' ? new Set<string>() : reach(rootSet, idx.preds)
  const down = dir === 'up' ? new Set<string>() : reach(rootSet, idx.succs)
  const upper = new Set([...rootSet, ...up])
  const lower = new Set([...rootSet, ...down])
  const ids = new Set([...upper, ...lower])
  const edges = new Set<string>()
  for (const [to, ps] of idx.preds) {
    for (const from of ps) {
      if ((dir !== 'down' && upper.has(to) && upper.has(from)) || (dir !== 'up' && lower.has(from) && lower.has(to))) {
        edges.add(edgeKey(from, to))
      }
    }
  }
  return { ids, edges }
}

// Why `pred -> succ` cannot be added, or null when it can
export function dependencyRefusal(tasks: readonly GanttTask[], pred: string, succ: string): string | null {
  const idx = depIndex(tasks)
  if (pred === succ) return 'A task cannot depend on itself'
  const s = idx.byId.get(succ)
  if (s?.dependencies?.includes(pred)) return 'Already linked'
  if (reach([succ], idx.succs).has(pred)) return 'Would create a loop'
  return null
}

// Tasks that may not become predecessors of `id` (itself, already linked, or
// downstream of it, which would close a loop): one walk for a whole picker
export function refusedPredecessors(tasks: readonly GanttTask[], id: string): Map<string, string> {
  const idx = depIndex(tasks)
  const out = new Map<string, string>([[id, 'This task']])
  for (const p of idx.preds.get(id) ?? []) out.set(p, 'Already a predecessor')
  for (const s of reach([id], idx.succs)) if (!out.has(s)) out.set(s, 'Would create a loop')
  return out
}

// Tasks that may not become successors of `id` (itself, already linked, or
// upstream of it)
export function refusedSuccessors(tasks: readonly GanttTask[], id: string): Map<string, string> {
  const idx = depIndex(tasks)
  const out = new Map<string, string>([[id, 'This task']])
  for (const s of idx.succs.get(id) ?? []) out.set(s, 'Already a successor')
  for (const p of reach([id], idx.preds)) if (!out.has(p)) out.set(p, 'Would create a loop')
  return out
}

// The day a task's own work ends / starts, in whole local days. A milestone
// is a point: a successor may start on its day, and it may sit on the last
// day of its predecessor.
const finishDay = (t: GanttTask) => (isMilestone(t) ? t.end ?? t.start : t.end)
const startDay = (t: GanttTask) => (isMilestone(t) ? t.end ?? t.start : t.start)

// Whether the link pred -> succ is violated: the successor starts before the
// predecessor is finished. Task -> task: start on or before the due day.
// From a milestone: start before its day. Into a milestone: its day before
// the predecessor's due day. Dateless ends never violate.
export function violates(pred: GanttTask, succ: GanttTask): boolean {
  const f = finishDay(pred)
  const s = startDay(succ)
  if (!f || !s) return false
  const gap = daysBetween(f, s) // days from the predecessor's finish to the successor's start
  return isMilestone(pred) || isMilestone(succ) ? gap < 0 : gap <= 0
}

const violationCache = new WeakMap<readonly GanttTask[], Set<string>>()

// Every violated link, as edge keys (memoized on the array identity)
export function dependencyViolations(tasks: readonly GanttTask[]): Set<string> {
  const hit = violationCache.get(tasks)
  if (hit) return hit
  const idx = depIndex(tasks)
  const out = new Set<string>()
  for (const [to, ps] of idx.preds) {
    const s = idx.byId.get(to)!
    for (const from of ps) if (violates(idx.byId.get(from)!, s)) out.add(edgeKey(from, to))
  }
  violationCache.set(tasks, out)
  return out
}

// The predecessors `id` starts too early for
export function violatedPredecessors(tasks: readonly GanttTask[], id: string): GanttTask[] {
  const idx = depIndex(tasks)
  const t = idx.byId.get(id)
  if (!t) return []
  return (idx.preds.get(id) ?? []).map(p => idx.byId.get(p)!).filter(p => violates(p, t))
}

// Days to move `id` (keeping its length) so it starts right after its latest
// predecessor: the day after a task's due day, a milestone's own day. 0 when
// nothing needs to move, or nothing is known.
export function snapAfterPredecessors(tasks: readonly GanttTask[], id: string): number {
  const idx = depIndex(tasks)
  const t = idx.byId.get(id)
  const s = t && startDay(t)
  if (!t || !s) return 0
  let need = 0
  for (const pid of idx.preds.get(id) ?? []) {
    const p = idx.byId.get(pid)!
    const f = finishDay(p)
    if (!f) continue
    const earliest = isMilestone(p) || isMilestone(t) ? 0 : 1 // days after the finish day
    need = Math.max(need, earliest - daysBetween(f, s))
  }
  return need
}
