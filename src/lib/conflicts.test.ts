import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import type { RemoteTask } from './clickup'
import { findConflicts, mergeKeys, resolveConflicts, type Resolution } from './conflicts'
import { syncBaseOf } from './sync'

const LAST_SYNC = new Date(2026, 9, 10).getTime()
const BEFORE_SYNC = String(new Date(2026, 9, 1).getTime())
const AFTER_SYNC = String(new Date(2026, 9, 12).getTime())
const ms = (d: Date) => String(d.getTime())

function remote(id: string, p: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id, name: id, start_date: null, due_date: null, date_updated: BEFORE_SYNC,
    dependencies: [], parent: null, ...p,
  }
}

// Named like its remote twin, so only what a test sets differs
function local(id: string, p: Partial<GanttTask> = {}): GanttTask {
  return { id, name: p.clickupId ?? id, progress: 0, ...p }
}

// A linked row whose base is `agreed`, edited on the board to `edits`
function edited(agreed: GanttTask, edits: Partial<GanttTask>, deps: string[] = []): GanttTask {
  return { ...agreed, ...edits, syncBase: syncBaseOf(agreed, deps) }
}

const dep = (task: string, on: string) => ({ task_id: task, depends_on: on, type: 1 })
const brief = (c: { key: string; both: boolean }) => [c.key, c.both]

describe('findConflicts with a sync base', () => {
  const agreed = local('a', { clickupId: 'A', priority: 3, tags: [{ name: 'x' }] })
  const board = edited(agreed, { name: 'Mine', priority: 2 })
  // ClickUp changed the priority too and added a tag
  const theirs = remote('A', { priority: { orderindex: '1' }, tags: [{ name: 'x' }, { name: 'z' }], date_updated: AFTER_SYNC })

  it('pull flags board edits only, marking ones ClickUp changed too', () => {
    expect(findConflicts('pull', [board], [theirs], LAST_SYNC).map(brief)).toEqual([
      ['name', false], ['priority', true],
    ])
  })

  it('push flags ClickUp edits only', () => {
    expect(findConflicts('push', [board], [theirs], LAST_SYNC).map(brief)).toEqual([
      ['priority', true], ['tags', false],
    ])
  })

  it('ignores the same edit made on both sides', () => {
    const l = edited(agreed, { name: 'New' })
    expect(findConflicts('pull', [l], [remote('A', { name: 'New', priority: { orderindex: '3' }, tags: [{ name: 'x' }] })], LAST_SYNC)).toEqual([])
  })

  it('carries the full texts for editing a description', () => {
    const l = edited(local('a', { clickupId: 'A', description: 'old' }), { description: 'board text' })
    const [c] = findConflicts('pull', [l], [remote('A', { description: 'clickup text' })], LAST_SYNC)
    expect(c).toMatchObject({ key: 'description', both: true, text: { board: 'board text', clickup: 'clickup text' } })
  })

  it('offers one date for two milestones', () => {
    const d1 = new Date(2026, 9, 5)
    const l = edited(local('m', { clickupId: 'M', type: 'milestone', start: d1, end: d1 }), {})
    const d2 = new Date(2026, 9, 9)
    const r = remote('M', { custom_item_id: 1, start_date: ms(d2), due_date: ms(d2), date_updated: AFTER_SYNC })
    expect(findConflicts('push', [l], [r], LAST_SYNC).map(c => c.key)).toEqual(['end'])
  })

  it('merges sets three-way: removals on either side stick', () => {
    const base = local('a', { clickupId: 'A', tags: [{ name: 'x' }, { name: 'y' }] })
    const l = edited(base, { tags: [{ name: 'x' }, { name: 'y' }, { name: 'b' }] })
    const r = remote('A', { tags: [{ name: 'y' }, { name: 'c' }] })
    const [c] = findConflicts('push', [l], [r], LAST_SYNC)
    expect(c.items).toMatchObject({ board: ['x', 'y', 'b'], clickup: ['y', 'c'], merged: ['y', 'b', 'c'] })
  })

  it('merges sets as a union without a base', () => {
    expect(mergeKeys(['x', 'y', 'b'], ['y', 'c'])).toEqual(['x', 'y', 'b', 'c'])
  })

  it('flags a parent moved on both sides', () => {
    const tasks = [
      local('p1', { clickupId: 'P1', remoteParent: null }),
      local('p2', { clickupId: 'P2', remoteParent: null }),
      local('p3', { clickupId: 'P3', remoteParent: null }),
      local('c', { clickupId: 'C', parentId: 'p2', remoteParent: 'P1' }),
    ]
    const rem = [remote('P1'), remote('P2'), remote('P3'), remote('C', { parent: 'P3', date_updated: AFTER_SYNC })]
    expect(findConflicts('pull', tasks, rem, LAST_SYNC)).toEqual([expect.objectContaining({
      key: 'parent', taskId: 'c', board: 'P2', clickup: 'P3', both: true,
    })])
    expect(findConflicts('push', tasks, rem, LAST_SYNC).map(brief)).toEqual([['parent', true]])
  })

  it('tells which side changed a dependency edge', () => {
    const a = local('a', { clickupId: 'A', syncBase: {} })
    // Base: B waits on A. The board dropped the edge; ClickUp kept it
    const b = edited(local('b', { clickupId: 'B' }), {}, ['A'])
    const kept = [remote('A'), remote('B', { dependencies: [dep('B', 'A')], date_updated: AFTER_SYNC })]
    expect(findConflicts('pull', [a, b], kept, LAST_SYNC)).toEqual([expect.objectContaining({
      key: 'dep', label: 'Waits on "A"', board: 'No', clickup: 'Yes', predId: 'a',
    })])
    expect(findConflicts('push', [a, b], kept, LAST_SYNC)).toEqual([])

    // ClickUp dropped it, the board kept it
    const b2 = edited(local('b', { clickupId: 'B', dependencies: ['a'] }), {}, ['A'])
    const dropped = [remote('A'), remote('B', { date_updated: AFTER_SYNC })]
    expect(findConflicts('pull', [a, b2], dropped, LAST_SYNC)).toEqual([])
    expect(findConflicts('push', [a, b2], dropped, LAST_SYNC).map(c => [c.key, c.board, c.clickup])).toEqual([['dep', 'Yes', 'No']])
  })
})

describe('findConflicts without a sync base', () => {
  it('pull flags a board edit that ClickUp has not seen, not a ClickUp change', () => {
    const conflicts = findConflicts(
      'pull',
      [local('a', { clickupId: 'A', name: 'Mine' }), local('b', { clickupId: 'B', name: 'Old' })],
      [remote('A'), remote('B', { name: 'Theirs', date_updated: AFTER_SYNC })],
      LAST_SYNC,
    )
    expect(conflicts).toEqual([expect.objectContaining({
      id: 'a|name', taskId: 'a', key: 'name', board: 'Mine', clickup: 'A', both: false,
    })])
  })

  it('pull flags an unpushed re-parent and an unpushed dependency', () => {
    const conflicts = findConflicts(
      'pull',
      [
        local('p', { clickupId: 'P', remoteParent: null }),
        local('c', { clickupId: 'C', parentId: 'p', remoteParent: null, dependencies: ['p'] }),
      ],
      [remote('P'), remote('C')],
      LAST_SYNC,
    )
    expect(conflicts.map(c => [c.key, c.task])).toEqual([['parent', 'C'], ['dep', 'C']])
  })

  it('pull does not count a field the board never had', () => {
    expect(findConflicts('pull', [local('a', { clickupId: 'A' })], [remote('A', { status: { status: 'to do' } })], LAST_SYNC)).toEqual([])
  })

  it('pull reports nothing before the first pull or push', () => {
    expect(findConflicts('pull', [local('a', { clickupId: 'A', name: 'Mine' })], [remote('A')], 0)).toEqual([])
  })

  it('push flags a task changed in ClickUp since the last sync, not a board edit', () => {
    const conflicts = findConflicts(
      'push',
      [local('a', { clickupId: 'A', name: 'Mine' }), local('b', { clickupId: 'B', name: 'Old' })],
      [remote('A'), remote('B', { name: 'Theirs', date_updated: AFTER_SYNC })],
      LAST_SYNC,
    )
    expect(conflicts).toEqual([expect.objectContaining({ taskId: 'b', key: 'name', board: 'Old', clickup: 'Theirs' })])
  })

  it('push flags a dependency added in ClickUp that a push would remove', () => {
    const conflicts = findConflicts(
      'push',
      [local('a', { clickupId: 'A' }), local('b', { clickupId: 'B' })],
      [remote('A'), remote('B', { dependencies: [dep('B', 'A')], date_updated: AFTER_SYNC })],
      LAST_SYNC,
    )
    expect(conflicts.map(c => [c.key, c.task, c.label, c.board, c.clickup])).toEqual([['dep', 'B', 'Waits on "A"', 'No', 'Yes']])
  })
})

describe('resolveConflicts', () => {
  it('pull: overrides only what differs from ClickUp and logs every decision', () => {
    const agreed = local('a', { clickupId: 'A', priority: 3, tags: [{ name: 'x' }], description: 'old' })
    const l = edited(agreed, { name: 'Mine', priority: 2, tags: [{ name: 'x' }, { name: 'b' }], description: 'board text', assignees: [{ id: -1, username: 'legacy' }] })
    const r = remote('A', {
      name: 'Theirs', priority: { orderindex: '1' }, description: 'clickup text', date_updated: AFTER_SYNC,
      tags: [{ name: 'c', tag_bg: '#f00' }],
    })
    const conflicts = findConflicts('pull', [l], [r], LAST_SYNC)
    expect(conflicts.map(c => c.key)).toEqual(['name', 'priority', 'tags', 'description'])
    const picks = new Map<string, Resolution>([
      ['a|name', { use: 'board' }],
      ['a|priority', { use: 'clickup' }],
      ['a|tags', { use: 'merge', keys: ['c', 'b'] }],
      ['a|description', { use: 'edit', text: 'both texts' }],
    ])
    const { overrides, log } = resolveConflicts('pull', conflicts, picks, [l], [r])
    expect(overrides.get('a')).toEqual({
      fields: { name: 'Mine', tags: [{ name: 'c', tag_bg: '#f00' }, { name: 'b' }], description: 'both texts' },
    })
    expect(log).toEqual([
      {
        kind: 'resolved', task: 'Mine', taskId: 'a', clickupId: 'A',
        resolved: [
          { field: 'Name', board: 'Mine', clickup: 'Theirs', result: 'Mine', how: 'board' },
          { field: 'Priority', board: 'High', clickup: 'Urgent', result: 'Urgent', how: 'clickup' },
          { field: 'Tags', board: 'b, x', clickup: 'c', result: 'b, c', how: 'merge' },
          { field: 'Description', board: 'board text', clickup: 'clickup text', result: 'both texts', how: 'edit' },
        ],
      },
      expect.objectContaining({ kind: 'info' }),
    ])
  })

  it('push: ClickUp picks carry the status color and type, the parent and the edge', () => {
    const tasks = [
      local('p1', { clickupId: 'P1', remoteParent: null }),
      local('p2', { clickupId: 'P2', remoteParent: null }),
      local('c', { clickupId: 'C', parentId: 'p1', remoteParent: 'P1', status: 'to do' }),
    ]
    const r = remote('C', {
      parent: 'P2', status: { status: 'done', color: '#0f0', type: 'closed' },
      dependencies: [dep('C', 'P1')], date_updated: AFTER_SYNC,
    })
    const rem = [remote('P1'), remote('P2'), r]
    const conflicts = findConflicts('push', tasks, rem, LAST_SYNC)
    expect(conflicts.map(c => c.key)).toEqual(['status', 'parent', 'dep'])
    const picks = new Map<string, Resolution>(conflicts.map(c => [c.id, { use: 'clickup' }]))
    const { overrides } = resolveConflicts('push', conflicts, picks, tasks, rem)
    expect(overrides.get('c')).toEqual({
      fields: { status: 'done', statusColor: '#0f0', statusType: 'closed' },
      parentId: 'p2',
      deps: { p1: true },
    })
  })

  it('needs no override when every pick is the side the run takes anyway', () => {
    const l = local('a', { clickupId: 'A', name: 'Mine' })
    const r = remote('A', { name: 'Theirs', date_updated: AFTER_SYNC })
    const conflicts = findConflicts('push', [l], [r], LAST_SYNC)
    const { overrides, log } = resolveConflicts('push', conflicts, new Map(), [l], [r])
    expect(overrides.size).toBe(0)
    expect(log.map(e => e.kind)).toEqual(['resolved'])
  })
})
