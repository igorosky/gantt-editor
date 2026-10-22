import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import {
  buildTree, canBecomeTopLevel, canOutdent, descendants, dragClosure, flattenTree,
  indentTarget, indentTask, moveTask, outdentTask, removeSubtree, setParent, sortByDate, subtreeSpan,
} from './tree'

const d = (m: number, day: number) => new Date(2026, m - 1, day)

function t(id: string, p: Partial<GanttTask> = {}): GanttTask {
  return { id, name: id, progress: 0, ...p }
}

// a
//   a1
//     a1x
//   a2
// b
//   b1
const SAMPLE = [
  t('a'), t('b'), t('a1', { parentId: 'a' }), t('b1', { parentId: 'b' }),
  t('a2', { parentId: 'a' }), t('a1x', { parentId: 'a1' }),
]

const order = (tasks: GanttTask[], opts = {}) => flattenTree(tasks, opts).map(r => r.task.id)
const parents = (tasks: GanttTask[]) => Object.fromEntries(tasks.map(x => [x.id, x.parentId]))

describe('flattenTree', () => {
  it('puts every subtree right under its parent, siblings in array order', () => {
    const rows = flattenTree(SAMPLE)
    expect(rows.map(r => r.task.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1'])
    expect(rows.map(r => r.depth)).toEqual([0, 1, 2, 1, 0, 1])
    expect(rows[0].childCount).toBe(2)
    expect(rows[2].childCount).toBe(0)
  })

  it('hides the subtree of a collapsed task', () => {
    const rows = flattenTree(SAMPLE, { collapsed: new Set(['a', 'b1']) })
    expect(rows.map(r => r.task.id)).toEqual(['a', 'b', 'b1'])
    expect(rows[0].collapsed).toBe(true)
    expect(rows[2].collapsed).toBe(false) // a leaf is never shown as collapsed
  })

  it('treats orphans and cycles as roots', () => {
    const tasks = [t('x', { parentId: 'gone' }), t('p', { parentId: 'q' }), t('q', { parentId: 'p' }), t('c', { parentId: 'p' })]
    expect(order(tasks)).toEqual(['x', 'p', 'c', 'q'])
    expect(order([t('self', { parentId: 'self' })])).toEqual(['self'])
  })

  it('adds ancestors of filter matches as expanded context rows', () => {
    const rows = flattenTree(SAMPLE, { include: new Set(['a1x', 'b']), collapsed: new Set(['a', 'b']) })
    expect(rows.map(r => [r.task.id, r.context])).toEqual([
      ['a', true], ['a1', true], ['a1x', false], ['b', false],
    ])
    expect(rows[3].collapsed).toBe(true)
  })

  it('counts done subtasks', () => {
    const rows = flattenTree([t('p'), t('c1', { parentId: 'p', statusType: 'done' }), t('c2', { parentId: 'p' })])
    expect(rows[0]).toMatchObject({ childCount: 2, doneChildren: 1 })
  })
})

describe('spans and closures', () => {
  it('spans the dated subtasks at any depth', () => {
    const tasks = [
      t('p', { start: d(10, 10), end: d(10, 12) }),
      t('c', { parentId: 'p', start: d(10, 5), end: d(10, 8) }),
      t('g', { parentId: 'c', end: d(10, 20) }),
      t('u', { parentId: 'p' }),
    ]
    expect(subtreeSpan('p', buildTree(tasks))).toEqual({ start: d(10, 5), end: d(10, 20) })
    expect(subtreeSpan('u', buildTree(tasks))).toBeNull()
  })

  it('moves subtasks and successors (also of subtasks) with a dragged task', () => {
    const tasks = [
      t('p'), t('c', { parentId: 'p' }), t('s', { dependencies: ['c'] }),
      t('s2', { dependencies: ['s'] }), t('other'),
    ]
    expect(dragClosure('p', tasks).sort()).toEqual(['c', 's', 's2'])
    expect(dragClosure('c', tasks).sort()).toEqual(['s', 's2'])
  })
})

describe('moveTask', () => {
  it('drops before / after a target as its sibling', () => {
    const before = moveTask(SAMPLE, 'b1', 'a2', 'before')
    expect(order(before)).toEqual(['a', 'a1', 'a1x', 'b1', 'a2', 'b'])
    expect(before.find(x => x.id === 'b1')!.parentId).toBe('a')
    const after = moveTask(SAMPLE, 'a1', 'b', 'after')
    expect(order(after)).toEqual(['a', 'a2', 'b', 'b1', 'a1', 'a1x'])
    expect(after.find(x => x.id === 'a1')!.parentId).toBeUndefined()
  })

  it('nests as the last or first subtask', () => {
    expect(order(moveTask(SAMPLE, 'b', 'a', 'inside'))).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1'])
    expect(flattenTree(moveTask(SAMPLE, 'b', 'a', 'inside')).find(r => r.task.id === 'b')!.depth).toBe(1)
    expect(order(moveTask(SAMPLE, 'b1', 'a', 'inside-first'))).toEqual(['a', 'b1', 'a1', 'a1x', 'a2', 'b'])
  })

  it('refuses to move a task into its own subtree or onto itself', () => {
    expect(moveTask(SAMPLE, 'a', 'a1x', 'inside')).toBe(SAMPLE)
    expect(moveTask(SAMPLE, 'a', 'a1', 'after')).toBe(SAMPLE)
    expect(moveTask(SAMPLE, 'a', 'a', 'before')).toBe(SAMPLE)
  })

  it('keeps a ClickUp subtask under some parent', () => {
    const linked = [t('p', { clickupId: 'P' }), t('c', { parentId: 'p', clickupId: 'C', remoteParent: 'P' }), t('q')]
    expect(canBecomeTopLevel(linked[1])).toBe(false)
    expect(moveTask(linked, 'c', 'q', 'after')).toBe(linked)
    expect(setParent(linked, 'c', undefined)).toBe(linked)
    expect(outdentTask(linked, 'c')).toBe(linked)
    expect(canOutdent(buildTree(linked), 'c')).toBe(false)
    // moving it under another parent is fine
    expect(parents(moveTask(linked, 'c', 'q', 'inside')).c).toBe('q')
    // a subtask only nested locally can go back to the top level
    const local = [t('p'), t('c', { parentId: 'p', clickupId: 'C', remoteParent: null })]
    expect(parents(setParent(local, 'c', undefined)).c).toBeUndefined()
  })
})

describe('indent / outdent / setParent / remove', () => {
  it('indents under the previous sibling', () => {
    expect(indentTarget(buildTree(SAMPLE), 'b')).toBe('a')
    expect(indentTarget(buildTree(SAMPLE), 'a')).toBeNull()
    expect(indentTarget(buildTree(SAMPLE), 'a2')).toBe('a1')
    const next = indentTask(SAMPLE, 'a2')
    expect(parents(next).a2).toBe('a1')
    expect(order(next)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1'])
    expect(indentTask(SAMPLE, 'a')).toBe(SAMPLE)
  })

  it('outdents to right after the old parent', () => {
    const next = outdentTask(SAMPLE, 'a1x')
    expect(parents(next).a1x).toBe('a')
    expect(order(next)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1'])
    expect(flattenTree(next)[2].depth).toBe(1)
    expect(outdentTask(SAMPLE, 'a')).toBe(SAMPLE)
  })

  it('re-parents as the last subtask, or detaches after its top-level tree', () => {
    expect(order(setParent(SAMPLE, 'a1', 'b'))).toEqual(['a', 'a2', 'b', 'b1', 'a1', 'a1x'])
    expect(order(setParent(SAMPLE, 'a1x', undefined))).toEqual(['a', 'a1', 'a2', 'a1x', 'b', 'b1'])
    expect(setParent(SAMPLE, 'a1', 'a')).toBe(SAMPLE)
  })

  it('removes a whole subtree', () => {
    expect(removeSubtree(SAMPLE, 'a').map(x => x.id)).toEqual(['b', 'b1'])
    expect(descendants('a', buildTree(SAMPLE)).map(x => x.id)).toEqual(['a1', 'a1x', 'a2'])
  })
})

describe('sortByDate', () => {
  const ids = (tasks: GanttTask[]) => tasks.map(x => x.id)

  it('sorts every sibling level, each subtask stays under its parent', () => {
    const tasks = [
      t('b', { start: d(3, 5), end: d(3, 9) }),
      t('a', { start: d(3, 1), end: d(3, 20) }),
      t('a2', { parentId: 'a', start: d(3, 12), end: d(3, 14) }),
      t('b1', { parentId: 'b', start: d(3, 6), end: d(3, 7) }),
      t('a1', { parentId: 'a', start: d(3, 2), end: d(3, 4) }),
    ]
    const sorted = sortByDate(tasks, 'start')
    expect(order(sorted)).toEqual(['a', 'a1', 'a2', 'b', 'b1'])
    expect(parents(sorted)).toEqual(parents(tasks))
  })

  it('puts undated tasks last in both directions', () => {
    const tasks = [
      t('none'),
      t('late', { start: d(3, 9), end: d(3, 10) }),
      t('early', { start: d(3, 1), end: d(3, 12) }),
    ]
    expect(ids(sortByDate(tasks, 'start', 'asc'))).toEqual(['early', 'late', 'none'])
    expect(ids(sortByDate(tasks, 'start', 'desc'))).toEqual(['late', 'early', 'none'])
    expect(ids(sortByDate(tasks, 'due', 'asc'))).toEqual(['late', 'early', 'none'])
    expect(ids(sortByDate(tasks, 'due', 'desc'))).toEqual(['early', 'late', 'none'])
  })

  it('uses the one date of a half-dated task or a milestone for both keys', () => {
    const tasks = [
      t('x', { start: d(3, 4), end: d(3, 6) }),
      t('dueOnly', { end: d(3, 5) }),
      t('m', { type: 'milestone', start: d(3, 3), end: d(3, 3) }),
    ]
    expect(ids(sortByDate(tasks, 'start'))).toEqual(['m', 'x', 'dueOnly'])
    expect(ids(sortByDate(tasks, 'due'))).toEqual(['m', 'dueOnly', 'x'])
  })

  it('compares by day: a time of day is a tie, broken by the other date, then the current order', () => {
    const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 2, day, h, m, s)
    const tasks = [
      t('p', { start: at(2, 4), end: at(8, 0) }), // ClickUp 4 am start
      t('q', { start: at(2, 0), end: at(5, 23, 59, 59) }), // frappe end
      t('r', { start: at(2, 0), end: at(8, 4) }),
    ]
    expect(ids(sortByDate(tasks, 'start'))).toEqual(['q', 'p', 'r'])
    expect(ids(sortByDate(tasks, 'start', 'desc'))).toEqual(['p', 'r', 'q'])
  })

  it('returns the same array when nothing moves', () => {
    const tasks = [t('a', { start: d(3, 1), end: d(3, 2) }), t('b', { start: d(3, 3), end: d(3, 4) }), t('u')]
    expect(sortByDate(tasks, 'start')).toBe(tasks)
    expect(sortByDate(tasks, 'start', 'desc')).not.toBe(tasks)
  })
})
