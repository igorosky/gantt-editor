import { describe, expect, it } from 'vitest'
import {
  BOARDS_KEY, CONFIG_KEY, boardForList, boardKey, boardPatchFromRemote, boardSummary, ensureMigrated,
  nextLocalName, normalizeBoards, normalizeConfig, recentBoards, removeBoardData, type KeyStore,
} from './boards'
import type { RemoteTask } from './clickup'
import type { BoardRef, GanttTask } from '../types'

function memStore(init: Record<string, string> = {}): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init))
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: k => { data.delete(k) },
  }
}

const NOW = new Date('2026-10-22T10:00:00Z')
const id = () => 'b1'

describe('ensureMigrated', () => {
  it('turns the single linked board into the first board and keeps only the connection', () => {
    const store = memStore({
      [CONFIG_KEY]: JSON.stringify({
        token: 'pk_x', teamId: 'T', spaceId: 'S', folder: 'F', listId: 'L', lastSyncAt: '2026-10-01T00:00:00Z',
      }),
      'portfolio-config': JSON.stringify({ refs: [{ listId: 'L', name: 'Website', spaceName: 'Mkt', folderName: 'Q4' }] }),
      'gantt-tasks': '[{"id":"a"}]',
      'gantt-pending-deletions': '[]',
      'gantt-sync-log': '[{"id":"r"}]',
    })
    const state = ensureMigrated(store, id, NOW)
    expect(state).toEqual({
      current: 'b1',
      boards: [{
        id: 'b1', name: 'Website', listId: 'L', spaceId: 'S', spaceName: 'Mkt', folderName: 'Q4',
        lastSyncAt: '2026-10-01T00:00:00Z', openedAt: NOW.toISOString(),
      }],
    })
    expect(store.data.get(boardKey('tasks', 'b1'))).toBe('[{"id":"a"}]')
    expect(store.data.get(boardKey('pending', 'b1'))).toBe('[]')
    expect(store.data.get(boardKey('log', 'b1'))).toBe('[{"id":"r"}]')
    expect(store.data.has('gantt-tasks')).toBe(false)
    expect(store.data.has('gantt-sync-log')).toBe(false)
    expect(JSON.parse(store.data.get(CONFIG_KEY)!)).toEqual({ token: 'pk_x', teamId: 'T' })
    expect(normalizeBoards(JSON.parse(store.data.get(BOARDS_KEY)!))).toEqual(state)
  })

  it('names a linked board generically when the portfolio does not know the list', () => {
    const store = memStore({ [CONFIG_KEY]: JSON.stringify({ token: 'pk', teamId: 'T', listId: 'L' }) })
    expect(ensureMigrated(store, id, NOW).boards[0]).toMatchObject({ name: 'ClickUp list', listId: 'L' })
  })

  it('makes a local board without a list, moving its tasks', () => {
    const store = memStore({ 'gantt-tasks': '[]' })
    const state = ensureMigrated(store, id, NOW)
    expect(state.boards).toEqual([{ id: 'b1', name: 'My board', openedAt: NOW.toISOString() }])
    expect(store.data.get(boardKey('tasks', 'b1'))).toBe('[]')
    expect(store.data.has(CONFIG_KEY)).toBe(false)
  })

  it('creates one local board on a fresh install and writes no tasks (the example task comes from loading)', () => {
    const store = memStore()
    const state = ensureMigrated(store, id, NOW)
    expect(state.boards).toHaveLength(1)
    expect(store.data.has(boardKey('tasks', 'b1'))).toBe(false)
  })

  it('is idempotent', () => {
    const store = memStore({ [CONFIG_KEY]: JSON.stringify({ token: 'pk', teamId: 'T', listId: 'L' }), 'gantt-tasks': '[1]' })
    const first = ensureMigrated(store, id, NOW)
    const again = ensureMigrated(store, () => 'other', new Date())
    expect(again).toEqual(first)
    expect(store.data.get(boardKey('tasks', 'b1'))).toBe('[1]')
  })

  it('restores the old key and throws when the move does not fit', () => {
    const store = memStore({ 'gantt-tasks': '[1]' })
    const full: KeyStore = {
      ...store,
      setItem: (k, v) => {
        if (k.includes('@')) throw new Error('QuotaExceededError')
        store.setItem(k, v)
      },
    }
    expect(() => ensureMigrated(full, id, NOW)).toThrow()
    expect(store.data.get('gantt-tasks')).toBe('[1]')
    expect(store.data.has(BOARDS_KEY)).toBe(false)
  })
})

describe('normalizeBoards / normalizeConfig', () => {
  it('drops malformed boards and a second board for the same list, and fixes a dangling current', () => {
    const n = normalizeBoards({
      current: 'gone',
      boards: [
        null, { name: 'no id' }, { id: 'a', name: 'A', listId: 'L', lastSyncAt: 5 },
        { id: 'a', name: 'dup id' }, { id: 'b', name: 'B', listId: 'L' }, { id: 'c', name: '' },
      ],
    })
    expect(n?.current).toBe('a')
    expect(n?.boards.map(b => [b.id, b.name, b.lastSyncAt])).toEqual([['a', 'A', undefined], ['c', 'Board', undefined]])
  })

  it('returns null with nothing usable', () => {
    expect(normalizeBoards(null)).toBeNull()
    expect(normalizeBoards({ boards: [] })).toBeNull()
    expect(normalizeBoards({ boards: 'x' })).toBeNull()
  })

  it('reads the connection, old shape included', () => {
    expect(normalizeConfig({ token: 'pk', teamId: 'T', listId: 'L', folder: 'F' })).toEqual({ token: 'pk', teamId: 'T' })
    expect(normalizeConfig({ token: 'pk' })).toEqual({ token: 'pk', teamId: '' })
    expect(normalizeConfig({ teamId: 'T' })).toBeNull()
  })
})

describe('board helpers', () => {
  const boards: BoardRef[] = [
    { id: 'a', name: 'A', listId: 'L1', openedAt: '2026-10-01T00:00:00Z' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C', listId: 'L2', openedAt: '2026-10-20T00:00:00Z' },
    { id: 'd', name: 'D' },
  ]

  it('orders by last opened, never opened last in saved order', () => {
    expect(recentBoards(boards).map(b => b.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('finds the board of a list', () => {
    expect(boardForList(boards, 'L2')?.id).toBe('c')
    expect(boardForList(boards, 'L3')).toBeUndefined()
  })

  it('numbers new local boards', () => {
    expect(nextLocalName(boards)).toBe('Local board')
    expect(nextLocalName([...boards, { id: 'e', name: 'Local board' }, { id: 'f', name: 'Local board 2' }]))
      .toBe('Local board 3')
  })

  it('takes the list name and a missing space from fetched tasks', () => {
    const remote = [{ list: { id: 'L1', name: 'Renamed' }, space: { id: 'S1' } }] as RemoteTask[]
    expect(boardPatchFromRemote(boards[0], remote)).toEqual({ name: 'Renamed', spaceId: 'S1' })
    expect(boardPatchFromRemote({ ...boards[0], name: 'Renamed', spaceId: 'S0' }, remote)).toEqual({})
    expect(boardPatchFromRemote(boards[0], [])).toEqual({})
  })

  it('removes every key of a board', () => {
    const store = memStore({ [boardKey('tasks', 'a')]: '[]', [boardKey('pending', 'a')]: '[]', [boardKey('log', 'a')]: '[]', [boardKey('tasks', 'b')]: '[]' })
    removeBoardData(store, 'a')
    expect([...store.data.keys()]).toEqual([boardKey('tasks', 'b')])
  })

  it('counts what removing a board loses', () => {
    const tasks = [{ id: '1', clickupId: 'x' }, { id: '2' }, { id: '3' }] as GanttTask[]
    expect(boardSummary(tasks, [])).toEqual({ boardOnly: 2, pending: 0 })
  })
})
