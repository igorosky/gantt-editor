import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GanttTask } from '../types'
import type { RemoteTask } from './clickup'
import { findConflicts } from './conflicts'
import {
  boardMilestones, pullFromClickUp, pushToClickUp, remoteMilestones, syncBaseOf, type Overrides,
} from './sync'
import type { MilestoneStyle } from './settings'

const CONFIG = { token: 'pk_test', listId: 'L' }
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

const dep = (task: string, on: string) => ({ task_id: task, depends_on: on, type: 1 })

interface Call { method: string; path: string; query: string; body?: Record<string, unknown> }

// Serves the remote list and records every write
function stubClickUp(): Call[] {
  const calls: Call[] = []
  let created = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const [path, query = ''] = url.replace(/^\/clickup/, '').split('?')
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : undefined
    calls.push({ method, path, query, body })
    if (method === 'POST' && path === '/list/L/task') {
      // ClickUp's create response; the parent is left out on purpose
      return new Response(JSON.stringify(remote(`new${++created}`, { name: String(body?.name) })), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }))
  return calls
}

const writes = (calls: Call[]) => calls.filter(c => c.method !== 'GET')
const byName = (tasks: GanttTask[], name: string) => tasks.find(t => t.name === name)!

describe('pullFromClickUp', () => {
  it('adopts ClickUp nesting on the first pull of pre-subtask data', () => {
    const { tasks } = pullFromClickUp(
      [local('p', { clickupId: 'P' }), local('c', { clickupId: 'C' })],
      [remote('P'), remote('C', { parent: 'P' })],
    )
    expect(byName(tasks, 'C')).toMatchObject({ parentId: 'p', remoteParent: 'P' })
    expect(byName(tasks, 'P')).toMatchObject({ parentId: undefined, remoteParent: null })
  })

  it('takes the ClickUp fields and logs old -> new', () => {
    const { tasks, entries } = pullFromClickUp(
      [local('a', { clickupId: 'A', name: 'Old', end: new Date(2026, 9, 5), priority: 3 })],
      [remote('A', {
        name: 'New', due_date: ms(new Date(2026, 9, 7)), priority: { orderindex: '1' }, time_estimate: 7_200_000,
      })],
    )
    expect(tasks[0]).toMatchObject({ id: 'a', name: 'New', end: new Date(2026, 9, 7), priority: 1, timeEstimate: 7_200_000 })
    expect(entries).toEqual([{
      kind: 'updated', task: 'New', taskId: 'a', clickupId: 'A',
      changes: [
        { field: 'Name', from: 'Old', to: 'New' },
        { field: 'Due', from: '05.10.2026', to: '07.10.2026' },
        { field: 'Priority', from: 'Normal', to: 'Urgent' },
        { field: 'Estimate', from: '', to: '2h' },
      ],
    }])
  })

  it('ignores a time-of-day difference', () => {
    const { entries } = pullFromClickUp(
      [local('a', { clickupId: 'A', end: new Date(2026, 9, 5, 23, 59, 59) })],
      [remote('A', { due_date: ms(new Date(2026, 9, 5, 4)) })],
    )
    expect(entries).toEqual([])
  })

  it('adds ClickUp-only tasks nested, drops deleted ones, keeps board-only rows', () => {
    const { tasks, entries } = pullFromClickUp(
      [local('x', { clickupId: 'X' }), local('y')],
      [remote('P'), remote('C', { parent: 'P' }), remote('G', { parent: 'C' })],
    )
    expect(tasks.map(t => t.name)).toEqual(['y', 'P', 'C', 'G'])
    expect(byName(tasks, 'C').parentId).toBe(byName(tasks, 'P').id)
    expect(byName(tasks, 'G').parentId).toBe(byName(tasks, 'C').id)
    expect(entries.map(e => [e.kind, e.task])).toEqual([
      ['removed', 'X'], ['added', 'P'], ['added', 'C'], ['added', 'G'], ['info', undefined],
    ])
  })

  it('lets a move made in ClickUp win and logs it', () => {
    const { tasks, entries } = pullFromClickUp(
      [
        local('p1', { clickupId: 'P1', remoteParent: null }),
        local('p2', { clickupId: 'P2', remoteParent: null }),
        local('c', { clickupId: 'C', parentId: 'p1', remoteParent: 'P1' }),
      ],
      [remote('P1'), remote('P2'), remote('C', { parent: 'P2' })],
    )
    expect(byName(tasks, 'C')).toMatchObject({ parentId: 'p2', remoteParent: 'P2' })
    expect(entries).toEqual([{
      kind: 'moved', task: 'C', taskId: 'c', clickupId: 'C',
      changes: [{ field: 'Parent', from: 'P1', to: 'P2' }],
    }])
  })

  it('keeps a subtask whose parent lives in another list at the top level', () => {
    const { tasks, entries } = pullFromClickUp([local('c', { clickupId: 'C' })], [remote('C', { parent: 'ELSEWHERE' })])
    expect(byName(tasks, 'C')).toMatchObject({ parentId: undefined, remoteParent: 'ELSEWHERE' })
    expect(entries).toEqual([])
  })

  it('mirrors dependencies but keeps edges to board-only rows', () => {
    const { tasks, entries } = pullFromClickUp(
      [
        local('a', { clickupId: 'A' }),
        local('b', { clickupId: 'B', dependencies: ['a', 'u'] }),
        local('c', { clickupId: 'C' }),
        local('u'),
      ],
      [remote('A'), remote('B'), remote('C', { dependencies: [dep('C', 'A')] })],
    )
    expect(byName(tasks, 'B').dependencies).toEqual(['u'])
    expect(byName(tasks, 'C').dependencies).toEqual(['a'])
    expect(entries.filter(e => e.kind.startsWith('dep')).map(e => [e.kind, e.task, e.detail])).toEqual([
      ['dep-removed', 'B', 'no longer waits on "A"'],
      ['dep-added', 'C', 'waits on "A"'],
    ])
  })
})

describe('pushToClickUp', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('writes nothing when the board matches ClickUp', async () => {
    const calls = stubClickUp()
    const { entries, patches } = await pushToClickUp(
      CONFIG,
      [local('a', { clickupId: 'A', end: new Date(2026, 9, 5, 23, 59, 59) })],
      // A priority / description the board never had is not a change to push
      [remote('A', { due_date: ms(new Date(2026, 9, 5, 4)), priority: { orderindex: '2' }, description: 'x', time_estimate: 3_600_000 })],
    )
    expect(writes(calls)).toEqual([])
    expect(entries).toEqual([])
    // Only the baselines are recorded: parent, and ClickUp's fields
    expect([...patches.keys()]).toEqual(['a'])
    expect(patches.get('a')).toEqual({
      remoteParent: null,
      syncBase: { ...syncBaseOf(local('a', { clickupId: 'A', name: 'A', end: new Date(2026, 9, 5), priority: 2, description: 'x' })), deps: '' },
    })
  })

  it('sends only the changed fields and logs ClickUp old -> board new', async () => {
    const calls = stubClickUp()
    const end = new Date(2026, 9, 7)
    const { entries } = await pushToClickUp(
      CONFIG,
      [local('a', { clickupId: 'A', name: 'New', end, tags: [{ name: 'x' }] })],
      [remote('A', { name: 'Old', due_date: ms(new Date(2026, 9, 5)), tags: [{ name: 'y' }] })],
    )
    expect(writes(calls)).toEqual([
      { method: 'PUT', path: '/task/A', query: '', body: { name: 'New', due_date: ms(end), due_date_time: false } },
      { method: 'POST', path: '/task/A/tag/x', query: '', body: undefined },
      { method: 'DELETE', path: '/task/A/tag/y', query: '', body: undefined },
    ])
    expect(entries).toEqual([{
      kind: 'updated', task: 'New', taskId: 'a', clickupId: 'A',
      changes: [
        { field: 'Name', from: 'Old', to: 'New' },
        { field: 'Due', from: '05.10.2026', to: '07.10.2026' },
        { field: 'Tags', from: 'y', to: 'x' },
      ],
    }])
  })

  it('pushes a local re-parent', async () => {
    const calls = stubClickUp()
    const { patches, entries } = await pushToClickUp(
      CONFIG,
      [
        local('p1', { clickupId: 'P1', remoteParent: null }),
        local('p2', { clickupId: 'P2', remoteParent: null }),
        local('c', { clickupId: 'C', parentId: 'p2', remoteParent: 'P1' }),
      ],
      [remote('P1'), remote('P2'), remote('C', { parent: 'P1' })],
    )
    expect(writes(calls)).toEqual([{ method: 'PUT', path: '/task/C', query: '', body: { parent: 'P2' } }])
    expect(patches.get('c')).toMatchObject({ remoteParent: 'P2' })
    expect(entries.map(e => e.kind)).toEqual(['moved'])
  })

  it('creates a new parent before its new subtask', async () => {
    const calls = stubClickUp()
    const { patches, entries } = await pushToClickUp(
      CONFIG,
      [local('m', { name: 'Child', parentId: 'n' }), local('n', { name: 'Parent' })],
      [],
    )
    const posts = writes(calls)
    expect(posts.map(c => [c.method, c.body?.name])).toEqual([['POST', 'Parent'], ['POST', 'Child']])
    expect(posts[1].body?.parent).toBe('new1')
    expect(patches.get('m')).toMatchObject({ clickupId: 'new2', remoteParent: 'new1', syncBase: { name: 'Child', deps: '' } })
    expect(entries.map(e => [e.kind, e.task, e.detail])).toEqual([
      ['created', 'Parent', undefined],
      ['created', 'Child', 'subtask of "Parent"'],
    ])
  })

  it('never sends a null parent; a local un-nesting is reported instead', async () => {
    const calls = stubClickUp()
    const { entries } = await pushToClickUp(
      CONFIG,
      [local('p', { clickupId: 'P', remoteParent: null }), local('c', { clickupId: 'C', remoteParent: 'P' })],
      [remote('P'), remote('C', { parent: 'P' })],
    )
    expect(writes(calls)).toEqual([])
    expect(entries.map(e => [e.kind, e.task])).toEqual([['error', 'C']])
  })

  it('leaves a subtask whose parent lives in another list untouched', async () => {
    const calls = stubClickUp()
    const { entries } = await pushToClickUp(
      CONFIG,
      [local('c', { clickupId: 'C', remoteParent: 'ELSEWHERE' })],
      [remote('C', { parent: 'ELSEWHERE' })],
    )
    expect(writes(calls)).toEqual([])
    expect(entries).toEqual([])
  })

  it('mirrors dependencies between board tasks, leaving edges to other tasks alone', async () => {
    const calls = stubClickUp()
    const { entries } = await pushToClickUp(
      CONFIG,
      [
        local('a', { clickupId: 'A' }),
        local('b', { clickupId: 'B', dependencies: ['a'] }),
        local('c', { clickupId: 'C' }),
      ],
      [remote('A'), remote('B'), remote('C', { dependencies: [dep('C', 'A'), dep('C', 'Z')] }), remote('Z')],
    )
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/task/B/dependency', query: '', body: { depends_on: 'A' } },
      { method: 'DELETE', path: '/task/C/dependency', query: 'depends_on=A&dependency_of=C', body: undefined },
    ])
    expect(entries.map(e => [e.kind, e.task])).toEqual([
      ['dep-added', 'B'], ['dep-removed', 'C'], ['info', undefined],
    ])
  })

  it('skips a linked task deleted in ClickUp instead of recreating it', async () => {
    const calls = stubClickUp()
    const { entries } = await pushToClickUp(CONFIG, [local('x', { clickupId: 'X' })], [])
    expect(writes(calls)).toEqual([])
    expect(entries.map(e => e.kind)).toEqual(['skipped'])
  })

  it('logs a failed update as an error and carries on', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/task/A')
        ? new Response(JSON.stringify({ err: 'Boom' }), { status: 500 })
        : new Response('{}', { status: 200 })))
    const { entries } = await pushToClickUp(
      CONFIG,
      [local('a', { clickupId: 'A', name: 'A2' }), local('b', { clickupId: 'B', name: 'B2' })],
      [remote('A'), remote('B')],
    )
    expect(entries.map(e => [e.kind, e.task, e.detail])).toEqual([
      ['error', 'A2', 'Update failed: Boom'],
      ['updated', 'B2', undefined],
    ])
  })
})


describe('sync base and overrides', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('pull records ClickUp as the base under an override, so the next push sends the resolved value', async () => {
    const theirs = remote('A', { tags: [{ name: 'y' }], description: 'theirs', date_updated: AFTER_SYNC })
    const overrides: Overrides = new Map([['a', { fields: { tags: [{ name: 'x' }, { name: 'y' }], description: 'mine' } }]])
    const { tasks, entries } = pullFromClickUp(
      [local('a', { clickupId: 'A', tags: [{ name: 'x' }], description: 'mine' })],
      [theirs],
      overrides,
    )
    expect(tasks[0]).toMatchObject({ tags: [{ name: 'x' }, { name: 'y' }], description: 'mine' })
    expect(tasks[0].syncBase).toEqual(syncBaseOf(local('a', { name: 'A', tags: [{ name: 'y' }], description: 'theirs' }), []))
    expect(entries).toEqual([{
      kind: 'updated', task: 'A', taskId: 'a', clickupId: 'A',
      changes: [{ field: 'Tags', from: 'x', to: 'x, y' }],
    }])

    expect(findConflicts('push', tasks, [theirs], LAST_SYNC)).toEqual([])
    const calls = stubClickUp()
    await pushToClickUp(CONFIG, tasks, [theirs])
    expect(writes(calls)).toEqual([
      { method: 'PUT', path: '/task/A', query: '', body: { description: 'mine' } },
      { method: 'POST', path: '/task/A/tag/x', query: '', body: undefined },
    ])
  })

  it('pull keeps the board parent and dependency the user chose', () => {
    const { tasks } = pullFromClickUp(
      [
        local('p', { clickupId: 'P', remoteParent: null }),
        local('c', { clickupId: 'C', parentId: 'p', remoteParent: null, dependencies: ['p'] }),
      ],
      [remote('P'), remote('C')],
      new Map([['c', { parentId: 'p', deps: { p: true } }]]),
    )
    expect(byName(tasks, 'C')).toMatchObject({
      parentId: 'p', remoteParent: null, dependencies: ['p'], syncBase: { deps: '' },
    })
  })

  it('push writes resolved values to ClickUp and patches the board with them', async () => {
    const calls = stubClickUp()
    const overrides: Overrides = new Map([['a', { fields: { name: 'Theirs', tags: [{ name: 'x' }, { name: 'y' }] } }]])
    const { patches } = await pushToClickUp(
      CONFIG,
      [local('a', { clickupId: 'A', name: 'Mine', tags: [{ name: 'x' }] })],
      [remote('A', { name: 'Theirs', tags: [{ name: 'y' }] })],
      overrides,
    )
    // The name already matches ClickUp, so only the merged tag goes out
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/task/A/tag/x', query: '', body: undefined }])
    expect(patches.get('a')).toMatchObject({
      name: 'Theirs',
      tags: [{ name: 'x' }, { name: 'y' }],
      syncBase: { name: 'Theirs', tags: 'x\ny', deps: '' },
    })
  })

  it('push lets ClickUp win a parent and a dependency on the board', async () => {
    const calls = stubClickUp()
    const { patches } = await pushToClickUp(
      CONFIG,
      [
        local('p1', { clickupId: 'P1', remoteParent: null }),
        local('p2', { clickupId: 'P2', remoteParent: null }),
        local('c', { clickupId: 'C', parentId: 'p1', remoteParent: 'P1' }),
      ],
      [remote('P1'), remote('P2'), remote('C', { parent: 'P2', dependencies: [dep('C', 'P1')] })],
      new Map([['c', { parentId: 'p2', deps: { p1: true } }]]),
    )
    expect(writes(calls)).toEqual([])
    expect(patches.get('c')).toMatchObject({ parentId: 'p2', dependencies: ['p1'], remoteParent: 'P2', syncBase: { deps: 'P1' } })
  })

  it('keeps the old field base when the update fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ err: 'Boom' }), { status: 500 })))
    const { patches } = await pushToClickUp(
      CONFIG,
      [local('a', { clickupId: 'A', name: 'A2', syncBase: { name: 'A', deps: 'X' } })],
      [remote('A')],
    )
    expect(patches.get('a')?.syncBase).toEqual({ name: 'A', deps: '' })
  })

  it('records ClickUp edges after the push as the dependency base', async () => {
    stubClickUp()
    const { patches } = await pushToClickUp(
      CONFIG,
      [
        local('a', { clickupId: 'A' }),
        local('b', { clickupId: 'B', dependencies: ['a'] }),
        local('c', { clickupId: 'C' }),
      ],
      [remote('A'), remote('B'), remote('C', { dependencies: [dep('C', 'A'), dep('C', 'Z')] }), remote('Z')],
    )
    expect(patches.get('b')?.syncBase?.deps).toBe('A')
    expect(patches.get('c')?.syncBase?.deps).toBe('Z')
  })
})

describe('tag milestones', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const TAG: MilestoneStyle = { as: 'tag', tag: 'milestone' }
  const TAG_CONFIG = { ...CONFIG, milestones: TAG }
  const day = new Date(2026, 9, 7)

  it('reads the marker tag as the Milestone type and hides it', () => {
    const [a, b, c] = remoteMilestones([
      remote('A', { tags: [{ name: 'MileStone' }, { name: 'x' }] }),
      remote('B', { tags: [{ name: 'x' }], custom_item_id: 1002 }),
      // A real Milestone without the tag is a task here
      remote('C', { custom_item_id: 1 }),
    ], TAG)
    expect(a).toMatchObject({ custom_item_id: 1, tags: [{ name: 'x' }] })
    expect(b).toMatchObject({ custom_item_id: null, tags: [{ name: 'x' }] })
    expect(c.custom_item_id).toBeNull()
    const list = [remote('A', { tags: [{ name: 'milestone' }] })]
    expect(remoteMilestones(list, { as: 'type', tag: 'milestone' })).toBe(list)
  })

  it('pulls a tagged task as a milestone on its due date', () => {
    const { tasks } = pullFromClickUp([], remoteMilestones([remote('A', {
      start_date: ms(new Date(2026, 9, 1)), due_date: ms(day), tags: [{ name: 'milestone' }, { name: 'x' }],
    })], TAG))
    expect(tasks[0]).toMatchObject({ type: 'milestone', start: day, end: day, tags: [{ name: 'x' }] })
    expect(tasks[0].syncBase).toMatchObject({ type: 'Milestone', tags: 'x' })
  })

  it('writes nothing for a tagged milestone that matches the board', async () => {
    const calls = stubClickUp()
    const { entries } = await pushToClickUp(
      TAG_CONFIG,
      [local('a', { clickupId: 'A', type: 'milestone', start: day, end: day, tags: [{ name: 'x' }] })],
      remoteMilestones([remote('A', { due_date: ms(day), tags: [{ name: 'x' }, { name: 'milestone' }] })], TAG),
    )
    expect(writes(calls)).toEqual([])
    expect(entries).toEqual([])
  })

  it('flips the type through the marker tag, never custom_item_id', async () => {
    const calls = stubClickUp()
    const { patches } = await pushToClickUp(
      TAG_CONFIG,
      [
        local('a', { clickupId: 'A', name: 'A2', type: 'milestone', start: day, end: day }),
        local('b', { clickupId: 'B', type: 'task', start: day, end: day }),
      ],
      remoteMilestones([
        remote('A', { start_date: ms(day), due_date: ms(day) }),
        remote('B', { due_date: ms(day), tags: [{ name: 'milestone' }] }),
      ], TAG),
    )
    expect(writes(calls)).toEqual([
      { method: 'PUT', path: '/task/A', query: '', body: { name: 'A2' } },
      { method: 'POST', path: '/task/A/tag/milestone', query: '', body: undefined },
      { method: 'DELETE', path: '/task/B/tag/milestone', query: '', body: undefined },
    ])
    expect(patches.get('a')?.syncBase?.type).toBe('Milestone')
    expect(patches.get('b')?.syncBase?.type).toBe('Task')
  })

  it('leaves the marker alone when only other tags change', async () => {
    const calls = stubClickUp()
    await pushToClickUp(
      TAG_CONFIG,
      [local('a', { clickupId: 'A', type: 'milestone', start: day, end: day, tags: [{ name: 'x' }] })],
      remoteMilestones([remote('A', { due_date: ms(day), tags: [{ name: 'milestone' }, { name: 'y' }] })], TAG),
    )
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/task/A/tag/x', query: '', body: undefined },
      { method: 'DELETE', path: '/task/A/tag/y', query: '', body: undefined },
    ])
  })

  it('creates a milestone as a tagged task', async () => {
    const calls = stubClickUp()
    const { patches } = await pushToClickUp(
      TAG_CONFIG,
      [local('m', { name: 'M', type: 'milestone', start: day, end: day })],
      [],
    )
    const w = writes(calls)
    expect(w.map(c => [c.method, c.path])).toEqual([['POST', '/list/L/task'], ['POST', '/task/new1/tag/milestone']])
    expect(w[0].body).not.toHaveProperty('custom_item_id')
    expect(patches.get('m')?.syncBase?.type).toBe('Milestone')
  })

  it('still sends custom_item_id in type mode', async () => {
    const calls = stubClickUp()
    await pushToClickUp(CONFIG, [local('m', { name: 'M', type: 'milestone', start: day, end: day })], [])
    expect(writes(calls)[0].body).toMatchObject({ custom_item_id: 1 })
  })

  it('records a task when the marker of a new milestone fails, so the next push retries', async () => {
    const calls = stubClickUp()
    const ok = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      url.includes('/tag/')
        ? new Response(JSON.stringify({ err: 'Boom' }), { status: 500 })
        : ok(url, init)))
    const { patches, entries } = await pushToClickUp(
      TAG_CONFIG,
      [local('m', { name: 'M', type: 'milestone', start: day, end: day })],
      [],
    )
    expect(calls.map(c => c.path)).toEqual(['/list/L/task'])
    expect(entries.map(e => e.kind)).toEqual(['created', 'error'])
    expect(entries[1].detail).toMatch(/^Milestone tag "milestone" failed/)
    expect(patches.get('m')).toMatchObject({ clickupId: 'new1', syncBase: { type: 'Task' } })
  })

  it('turns board rows carrying the marker into milestones', () => {
    const tasks = [
      local('a', { start: new Date(2026, 9, 1), end: day, tags: [{ name: 'Milestone' }, { name: 'x' }] }),
      local('b', { tags: [{ name: 'milestone' }] }),
      local('c', { tags: [{ name: 'x' }] }),
    ]
    const out = boardMilestones(tasks, TAG)
    expect(out[0]).toMatchObject({ type: 'milestone', start: day, end: day, tags: [{ name: 'x' }] })
    expect(out[1]).toMatchObject({ type: 'milestone', tags: undefined })
    expect(out[2]).toBe(tasks[2])
    expect(boardMilestones([tasks[2]], TAG)).toEqual([tasks[2]])
    const same = [tasks[2]]
    expect(boardMilestones(same, TAG)).toBe(same)
    expect(boardMilestones(tasks, { as: 'type', tag: 'milestone' })).toBe(tasks)
  })

  it('finds no conflict after a pull in tag mode', () => {
    const remoteList = remoteMilestones([remote('A', { due_date: ms(day), tags: [{ name: 'milestone' }] })], TAG)
    const { tasks } = pullFromClickUp([], remoteList)
    expect(findConflicts('push', tasks, remoteList, LAST_SYNC)).toEqual([])
    expect(findConflicts('pull', tasks, remoteList, LAST_SYNC)).toEqual([])
  })
})
