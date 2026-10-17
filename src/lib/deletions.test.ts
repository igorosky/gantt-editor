import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GanttTask, PendingDeletion } from '../types'
import type { RemoteTask } from './clickup'
import { pendingCuids, planDeletions, prunePending, recordDeletion, restoreDeletion } from './deletions'
import { pullFromClickUp, pushToClickUp, type DeletionDecision } from './sync'
import { removeSubtree } from './tree'

const CONFIG = { token: 'pk_test', listId: 'L' }
const DELETED_AT = new Date(2026, 9, 10)
const BEFORE = String(new Date(2026, 9, 1).getTime())
const AFTER = String(new Date(2026, 9, 12).getTime())

function remote(id: string, p: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id, name: id, start_date: null, due_date: null, date_updated: BEFORE,
    dependencies: [], parent: null, ...p,
  }
}

function local(id: string, p: Partial<GanttTask> = {}): GanttTask {
  return { id, name: p.clickupId ?? id, progress: 0, ...p }
}

// Deletes `id` on the board, returning the board and the pending deletions
function del(board: GanttTask[], id: string, pending: PendingDeletion[] = []) {
  return { board: removeSubtree(board, id), pending: recordDeletion(pending, board, id, DELETED_AT) }
}

interface Call { method: string; path: string }

// Records every write; `status` picks the answer per DELETE path
function stubClickUp(status: Record<string, number> = {}): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace(/^\/clickup/, '').split('?')[0]
    calls.push({ method, path })
    const code = method === 'DELETE' ? status[path] ?? 200 : 200
    return new Response(code === 200 ? '{}' : JSON.stringify({ err: 'Nope' }), { status: code })
  }))
  return calls
}

const deletes = (calls: Call[]) => calls.filter(c => c.method === 'DELETE').map(c => c.path)

describe('recordDeletion / restoreDeletion', () => {
  const board = [
    local('a', { clickupId: 'A' }),
    local('p', { clickupId: 'P' }),
    local('x'),
    local('c', { clickupId: 'C', parentId: 'p' }),
    local('n', { parentId: 'p' }),
  ]

  it('snapshots a linked task with its subtasks, root first', () => {
    const { pending } = del(board, 'p')
    expect(pending).toEqual([{ id: 'p', deletedAt: DELETED_AT.toISOString(), index: 1, tasks: [board[1], board[3], board[4]] }])
    expect(pendingCuids(pending)).toEqual(new Set(['P', 'C']))
  })

  it('records nothing for rows that were never in ClickUp', () => {
    expect(del(board, 'x').pending).toEqual([])
    expect(del(board, 'n').pending).toEqual([])
  })

  it('restores the rows where they were, without duplicating', () => {
    const { board: after, pending } = del(board, 'p')
    expect(restoreDeletion(after, pending[0]).map(t => t.id)).toEqual(['a', 'p', 'c', 'n', 'x'])
    // A row that is back on the board (same ClickUp task) is left out
    const pulled = [...after, local('c2', { clickupId: 'C' })]
    expect(restoreDeletion(pulled, pending[0]).map(t => t.id)).toEqual(['a', 'p', 'n', 'x', 'c2'])
  })

  it('restores several deletions newest first to the original display order', () => {
    const one = del(board, 'a')
    const two = del(one.board, 'p', one.pending)
    const back = [...two.pending].reverse().reduce(restoreDeletion, two.board)
    // A subtree comes back contiguous; the display order is the same
    expect(back.map(t => t.id)).toEqual(['a', 'p', 'c', 'n', 'x'])
  })

  it('prunes deletions with nothing left in the list', () => {
    const { pending } = del(board, 'p')
    expect(prunePending(pending, [remote('C')])).toBe(pending)
    expect(prunePending(pending, [remote('A')])).toEqual([])
  })
})

describe('planDeletions', () => {
  it('asks once per deletion and deletes only the topmost task', () => {
    const board = [local('p', { clickupId: 'P' }), local('c', { clickupId: 'C', parentId: 'p' })]
    const { board: after, pending } = del(board, 'p')
    const [c, ...rest] = planDeletions(pending, after, [remote('P'), remote('C', { parent: 'P' })])
    expect(rest).toEqual([])
    expect(c).toMatchObject({
      id: 'p', name: 'P', deleteCuids: ['P'], doomed: ['P', 'C'], extra: [], changedInClickUp: false,
      tasks: [{ cuid: 'P', name: 'P' }, { cuid: 'C', name: 'C' }],
    })
  })

  it('skips deletions with nothing left in ClickUp', () => {
    const { board, pending } = del([local('a', { clickupId: 'A' })], 'a')
    expect(planDeletions(pending, board, [])).toEqual([])
  })

  it('lets a subtask moved on the board escape, warns about the rest', () => {
    const board = [
      local('p', { clickupId: 'P' }),
      local('q', { clickupId: 'Q' }),
      // Moved under q on the board; push moves it before deleting p
      local('m', { clickupId: 'M', parentId: 'q' }),
      // Top level on the board, but ClickUp cannot un-nest it
      local('t', { clickupId: 'T' }),
    ]
    const { board: after, pending } = del(board, 'p')
    const [c] = planDeletions(pending, after, [
      remote('P'), remote('Q'),
      remote('M', { parent: 'P' }),
      remote('T', { parent: 'P' }),
      remote('N', { parent: 'P', name: 'New in ClickUp' }),
    ])
    expect(c.doomed).toEqual(['P', 'T', 'N'])
    expect(c.extra).toEqual([
      { cuid: 'T', name: 'T', onBoard: true },
      { cuid: 'N', name: 'New in ClickUp', onBoard: false },
    ])
  })

  it('flags a task changed in ClickUp after the board delete', () => {
    const { board, pending } = del([local('a', { clickupId: 'A' })], 'a')
    expect(planDeletions(pending, board, [remote('A', { date_updated: AFTER })])[0].changedInClickUp).toBe(true)
  })

  it('does not count another pending deletion as an extra', () => {
    const board = [local('p', { clickupId: 'P' }), local('c', { clickupId: 'C', parentId: 'p' })]
    const one = del(board, 'c')
    const two = del(one.board, 'p', one.pending)
    const plan = planDeletions(two.pending, two.board, [remote('P'), remote('C', { parent: 'P' })])
    expect(plan.map(c => [c.id, c.deleteCuids, c.extra])).toEqual([['c', ['C'], []], ['p', ['P'], []]])
  })
})

describe('pull and push with pending deletions', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('pull leaves pending tasks off the board and says so', () => {
    const { board, pending } = del([local('a', { clickupId: 'A' }), local('b', { clickupId: 'B' })], 'a')
    const { tasks, entries } = pullFromClickUp(board, [remote('A'), remote('B')], undefined, pendingCuids(pending))
    expect(tasks.map(t => t.clickupId)).toEqual(['B'])
    expect(entries.map(e => e.kind)).toEqual(['info'])
  })

  async function push(decide: (c: DeletionDecision['candidate']) => boolean, status?: Record<string, number>) {
    const board = [
      local('a', { clickupId: 'A' }),
      local('p', { clickupId: 'P' }),
      local('c', { clickupId: 'C', parentId: 'p' }),
      local('k', { clickupId: 'K' }),
    ]
    let s = del(board, 'a')
    s = del(s.board, 'p', s.pending)
    const remoteList = [remote('A'), remote('P'), remote('C', { parent: 'P' }), remote('K')]
    const plan = planDeletions(s.pending, s.board, remoteList)
    const calls = stubClickUp(status)
    const res = await pushToClickUp(CONFIG, s.board, remoteList, undefined, plan.map(candidate => ({ candidate, remove: decide(candidate) })))
    return { calls, ...res }
  }

  it('deletes the confirmed ones last and keeps the rest', async () => {
    const { calls, entries, settled } = await push(c => c.id === 'p')
    expect(deletes(calls)).toEqual(['/task/P'])
    expect(settled).toEqual(['a', 'p'])
    expect(entries.map(e => [e.kind, e.task, e.detail])).toEqual([
      ['skipped', 'A', 'Deleted on the board; kept in ClickUp, Pull brings it back'],
      ['deleted', 'P', 'with 1 more ClickUp task'],
      ['info', undefined, '1 ClickUp task not on the board; Pull adds them'],
    ])
  })

  it('keeps a failed delete pending and treats 404 as already gone', async () => {
    const { entries, settled } = await push(() => true, { '/task/A': 500, '/task/P': 404 })
    expect(settled).toEqual(['p'])
    expect(entries.map(e => [e.kind, e.task])).toEqual([['error', 'A'], ['deleted', 'P']])
  })

  it('deletes a subtask once when its parent goes in the same run', async () => {
    const board = [local('p', { clickupId: 'P' }), local('c', { clickupId: 'C', parentId: 'p' })]
    const one = del(board, 'c')
    const two = del(one.board, 'p', one.pending)
    const remoteList = [remote('P'), remote('C', { parent: 'P' })]
    // Parent first, so the subtask's own delete has nothing left to do
    const plan = planDeletions(two.pending, two.board, remoteList).reverse()
    const calls = stubClickUp()
    const { settled } = await pushToClickUp(CONFIG, two.board, remoteList, undefined, plan.map(candidate => ({ candidate, remove: true })))
    expect(deletes(calls)).toEqual(['/task/P'])
    expect(settled).toEqual(['p', 'c'])
  })

  it('moves a subtask out before deleting its old parent', async () => {
    const board = [
      local('p', { clickupId: 'P' }),
      local('q', { clickupId: 'Q' }),
      local('m', { clickupId: 'M', parentId: 'q', remoteParent: 'P' }),
    ]
    const { board: after, pending } = del(board, 'p')
    const remoteList = [remote('P'), remote('Q'), remote('M', { parent: 'P' })]
    const plan = planDeletions(pending, after, remoteList)
    const calls = stubClickUp()
    await pushToClickUp(CONFIG, after, remoteList, undefined, plan.map(candidate => ({ candidate, remove: true })))
    expect(calls.filter(c => c.method !== 'GET')).toEqual([
      { method: 'PUT', path: '/task/M' },
      { method: 'DELETE', path: '/task/P' },
    ])
  })
})
