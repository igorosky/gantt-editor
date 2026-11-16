import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import {
  allPredecessors, allSuccessors, dependencyPath, dependencyRefusal, dependencyViolations,
  refusedPredecessors, refusedSuccessors, snapAfterPredecessors, violatedPredecessors, violates,
} from './depGraph'

const d = (s: string) => new Date(`${s}T00:00:00`)
const t = (id: string, deps: string[] = [], p: Partial<GanttTask> = {}): GanttTask =>
  ({ id, name: id, progress: 0, dependencies: deps, ...p })

// a -> r -> c, a -> c (bypass), x -> a, c -> y, z unrelated, r -> s
const graph = [t('x'), t('a', ['x']), t('r', ['a']), t('c', ['r', 'a']), t('y', ['c']), t('s', ['r']), t('z')]
const sorted = (s: Set<string>) => [...s].sort()

describe('reachability', () => {
  it('walks predecessors and successors transitively', () => {
    expect(sorted(allPredecessors(graph, ['r']))).toEqual(['a', 'x'])
    expect(sorted(allSuccessors(graph, ['r']))).toEqual(['c', 's', 'y'])
  })

  it('ignores dependencies on tasks that do not exist, and self links', () => {
    const tasks = [t('a', ['ghost', 'a']), t('b', ['a'])]
    expect(sorted(allPredecessors(tasks, ['b']))).toEqual(['a'])
  })

  it('terminates on cycles', () => {
    const tasks = [t('a', ['c']), t('b', ['a']), t('c', ['b'])]
    expect(sorted(allSuccessors(tasks, ['a']))).toEqual(['a', 'b', 'c'])
  })
})

describe('dependencyPath', () => {
  it('both directions: chains through the root, bypass edge excluded', () => {
    const p = dependencyPath(graph, ['r'])
    expect(sorted(p.ids)).toEqual(['a', 'c', 'r', 's', 'x', 'y'])
    expect(sorted(p.edges)).toEqual(['a->r', 'c->y', 'r->c', 'r->s', 'x->a'])
  })

  it('upstream only and downstream only', () => {
    const up = dependencyPath(graph, ['r'], 'up')
    expect(sorted(up.ids)).toEqual(['a', 'r', 'x'])
    expect(sorted(up.edges)).toEqual(['a->r', 'x->a'])
    const down = dependencyPath(graph, ['r'], 'down')
    expect(sorted(down.ids)).toEqual(['c', 'r', 's', 'y'])
    expect(sorted(down.edges)).toEqual(['c->y', 'r->c', 'r->s'])
  })

  it('several roots union their paths', () => {
    const p = dependencyPath(graph, ['a', 'z'], 'down')
    expect(sorted(p.ids)).toEqual(['a', 'c', 'r', 's', 'y', 'z'])
    expect(p.edges.has('a->c')).toBe(true)
  })

  it('unknown roots give an empty path', () => {
    const p = dependencyPath(graph, ['nope'])
    expect(p.ids.size).toBe(0)
    expect(p.edges.size).toBe(0)
  })
})

describe('adding dependencies', () => {
  it('refuses self, duplicates and loops', () => {
    expect(dependencyRefusal(graph, 'r', 'r')).toMatch(/itself/)
    expect(dependencyRefusal(graph, 'a', 'r')).toMatch(/Already/)
    expect(dependencyRefusal(graph, 'y', 'x')).toMatch(/loop/)
    expect(dependencyRefusal(graph, 'z', 'r')).toBeNull()
    expect(dependencyRefusal(graph, 'x', 'y')).toBeNull()
  })

  it('refused predecessor / successor sets match the single check', () => {
    const preds = refusedPredecessors(graph, 'r')
    const succs = refusedSuccessors(graph, 'r')
    for (const other of graph.map(g => g.id)) {
      expect(preds.has(other)).toBe(dependencyRefusal(graph, other, 'r') !== null)
      expect(succs.has(other)).toBe(dependencyRefusal(graph, 'r', other) !== null)
    }
  })
})

describe('violations', () => {
  const task = (id: string, start: string, end: string, deps: string[] = []) => t(id, deps, { start: d(start), end: d(end) })
  const ms = (id: string, day: string, deps: string[] = []) => t(id, deps, { type: 'milestone', start: d(day), end: d(day) })

  it('task -> task: a start on or before the due day is late', () => {
    expect(violates(task('p', '2026-03-02', '2026-03-06'), task('s', '2026-03-06', '2026-03-09'))).toBe(true)
    expect(violates(task('p', '2026-03-02', '2026-03-06'), task('s', '2026-03-05', '2026-03-09'))).toBe(true)
    expect(violates(task('p', '2026-03-02', '2026-03-06'), task('s', '2026-03-07', '2026-03-09'))).toBe(false)
  })

  it('ignores the time of day of the stored dates', () => {
    const p = t('p', [], { start: d('2026-03-02'), end: new Date('2026-03-06T23:59:59') })
    const s = t('s', ['p'], { start: new Date('2026-03-07T04:00:00'), end: d('2026-03-09') })
    expect(violates(p, s)).toBe(false)
  })

  it('milestones are points: same day is fine', () => {
    expect(violates(ms('m', '2026-03-06'), task('s', '2026-03-06', '2026-03-09'))).toBe(false)
    expect(violates(ms('m', '2026-03-06'), task('s', '2026-03-05', '2026-03-09'))).toBe(true)
    expect(violates(task('p', '2026-03-02', '2026-03-06'), ms('m', '2026-03-06'))).toBe(false)
    expect(violates(task('p', '2026-03-02', '2026-03-06'), ms('m', '2026-03-05'))).toBe(true)
  })

  it('dateless ends never violate', () => {
    expect(violates(t('p'), task('s', '2026-03-01', '2026-03-02'))).toBe(false)
    expect(violates(task('p', '2026-03-01', '2026-03-09'), t('s'))).toBe(false)
  })

  it('counts days across the DST change', () => {
    // Europe/Warsaw moves to summer time on 29 March 2026
    const p = task('p', '2026-03-23', '2026-03-28')
    expect(violates(p, task('s', '2026-03-29', '2026-03-30'))).toBe(false)
    expect(violates(p, task('s', '2026-03-28', '2026-03-30'))).toBe(true)
  })

  it('lists violated edges, memoized per array', () => {
    const tasks = [task('p', '2026-03-02', '2026-03-06'), task('s', '2026-03-04', '2026-03-09', ['p']), task('ok', '2026-03-10', '2026-03-11', ['p'])]
    const v = dependencyViolations(tasks)
    expect(sorted(v)).toEqual(['p->s'])
    expect(dependencyViolations(tasks)).toBe(v)
    expect(violatedPredecessors(tasks, 's').map(x => x.id)).toEqual(['p'])
    expect(violatedPredecessors(tasks, 'ok')).toEqual([])
  })

  it('snap moves a task to the day after its latest predecessor', () => {
    const tasks = [
      task('p1', '2026-03-02', '2026-03-06'),
      task('p2', '2026-03-02', '2026-03-10'),
      task('s', '2026-03-04', '2026-03-09', ['p1', 'p2']),
      ms('m', '2026-03-12'),
      task('after-ms', '2026-03-10', '2026-03-11', ['m']),
      task('fine', '2026-03-20', '2026-03-21', ['p1']),
    ]
    expect(snapAfterPredecessors(tasks, 's')).toBe(7) // 4 -> 11 March
    expect(snapAfterPredecessors(tasks, 'after-ms')).toBe(2) // starts on the milestone's day
    expect(snapAfterPredecessors(tasks, 'fine')).toBe(0)
    expect(snapAfterPredecessors(tasks, 'nope')).toBe(0)
  })
})
