// Boards kept in this browser. Each one is a local copy of a ClickUp list (or
// a local-only board) with its own tasks, pending deletions and sync log,
// stored under keys suffixed with the board id. The board switcher picks the
// current one; the ClickUp connection itself is only the token + workspace.

import type { BoardRef, ClickUpConfig, GanttTask, PendingDeletion } from '../types'
import type { RemoteTask } from './clickup'
import type { ProjectRef } from './portfolioData'

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const BOARDS_KEY = 'gantt-boards'
export const CONFIG_KEY = 'clickup-config'
const PORTFOLIO_CONFIG_KEY = 'portfolio-config'

// Per-board data; the bare names are the single-board keys from before boards
// existed, which ensureMigrated moves under the board id
const DATA_KEYS = { tasks: 'gantt-tasks', pending: 'gantt-pending-deletions', log: 'gantt-sync-log' } as const
export type BoardDataKind = keyof typeof DATA_KEYS

export const boardKey = (kind: BoardDataKind, id: string): string => `${DATA_KEYS[kind]}@${id}`

export interface BoardsState {
  current: string
  boards: BoardRef[]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function readJson(store: KeyStore, key: string): unknown {
  try {
    const raw = store.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Connection from storage; the shape from before boards (with the list
// fields) reduces to the same thing
export function normalizeConfig(raw: unknown): ClickUpConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const token = str(r.token)
  return token ? { token, teamId: str(r.teamId) ?? '' } : null
}

// Validates field by field; null when nothing usable is left. A list keeps
// one board, the first one.
export function normalizeBoards(raw: unknown): BoardsState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { current?: unknown; boards?: unknown }
  if (!Array.isArray(r.boards)) return null
  const ids = new Set<string>()
  const lists = new Set<string>()
  const boards: BoardRef[] = []
  for (const b of r.boards) {
    if (!b || typeof b !== 'object') continue
    const o = b as Record<string, unknown>
    const id = str(o.id)
    const listId = str(o.listId)
    if (!id || ids.has(id) || (listId && lists.has(listId))) continue
    ids.add(id)
    if (listId) lists.add(listId)
    boards.push({
      id,
      name: str(o.name) ?? 'Board',
      listId,
      spaceId: str(o.spaceId),
      spaceName: str(o.spaceName),
      folderName: str(o.folderName),
      lastSyncAt: str(o.lastSyncAt),
      openedAt: str(o.openedAt),
    })
  }
  if (!boards.length) return null
  const current = typeof r.current === 'string' && ids.has(r.current) ? r.current : boards[0].id
  return { current, boards }
}

// Reads the boards, creating them on first use. With the single board from
// before boards existed, that board becomes the first one: its list link and
// last sync come from the old ClickUp config, its tasks / pending deletions /
// sync log move under its id, and the config keeps only the connection.
// Idempotent; a failed move restores the old key and throws, so nothing is lost
// and the next load tries again.
export function ensureMigrated(
  store: KeyStore,
  newId: () => string = () => crypto.randomUUID(),
  now: Date = new Date(),
): BoardsState {
  const existing = normalizeBoards(readJson(store, BOARDS_KEY))
  if (existing) return existing

  const legacy = readJson(store, CONFIG_KEY) as Record<string, unknown> | null
  const listId = str(legacy?.listId)
  const id = newId()
  let board: BoardRef
  if (listId) {
    const refs = (readJson(store, PORTFOLIO_CONFIG_KEY) as { refs?: ProjectRef[] } | null)?.refs
    const ref = Array.isArray(refs) ? refs.find(r => r?.listId === listId) : undefined
    board = {
      id,
      name: ref?.name ?? 'ClickUp list',
      listId,
      spaceId: str(legacy?.spaceId),
      spaceName: ref?.spaceName,
      folderName: ref?.folderName,
      lastSyncAt: str(legacy?.lastSyncAt),
    }
  } else {
    board = { id, name: 'My board' }
  }
  board.openedAt = now.toISOString()

  for (const kind of Object.keys(DATA_KEYS) as BoardDataKind[]) {
    const v = store.getItem(DATA_KEYS[kind])
    if (v === null) continue
    // Free the old key first, so the move never needs room for two copies
    store.removeItem(DATA_KEYS[kind])
    try {
      store.setItem(boardKey(kind, id), v)
    } catch (e) {
      store.setItem(DATA_KEYS[kind], v)
      throw e
    }
  }
  if (legacy) {
    const c = normalizeConfig(legacy)
    if (c) store.setItem(CONFIG_KEY, JSON.stringify(c))
    else store.removeItem(CONFIG_KEY)
  }
  const state = { current: id, boards: [board] }
  store.setItem(BOARDS_KEY, JSON.stringify(state))
  return state
}

export function boardForList(boards: BoardRef[], listId: string): BoardRef | undefined {
  return boards.find(b => b.listId === listId)
}

// Most recently opened first; never opened last, in their saved order
export function recentBoards(boards: BoardRef[]): BoardRef[] {
  return boards
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.openedAt ?? '').localeCompare(x.b.openedAt ?? '') || x.i - y.i)
    .map(x => x.b)
}

// "Local board", "Local board 2", ... not taken yet
export function nextLocalName(boards: BoardRef[]): string {
  const names = new Set(boards.map(b => b.name))
  if (!names.has('Local board')) return 'Local board'
  let n = 2
  while (names.has(`Local board ${n}`)) n++
  return `Local board ${n}`
}

// A board for a list picked in the switcher / portfolio
export function listBoard(id: string, ref: ProjectRef, now: Date): BoardRef {
  return {
    id,
    name: ref.name,
    listId: ref.listId,
    spaceId: ref.spaceId,
    spaceName: ref.spaceName,
    folderName: ref.folderName,
    openedAt: now.toISOString(),
  }
}

// What a fetch of the board's list tells about the board: the list's current
// name, and the space when it was unknown (boards migrated or opened from an
// old portfolio pick). An empty list tells nothing.
export function boardPatchFromRemote(board: BoardRef, remote: RemoteTask[]): Partial<BoardRef> {
  const patch: Partial<BoardRef> = {}
  const name = remote.find(r => r.list?.name)?.list?.name
  if (name && name !== board.name) patch.name = name
  const spaceId = remote.find(r => r.space?.id)?.space?.id
  if (!board.spaceId && spaceId) patch.spaceId = spaceId
  return patch
}

export function removeBoardData(store: KeyStore, id: string): void {
  for (const kind of Object.keys(DATA_KEYS) as BoardDataKind[]) store.removeItem(boardKey(kind, id))
}

// What removing a board from this browser loses for good: tasks never pushed
// (no ClickUp id) and deletions not pushed yet
export function boardSummary(tasks: GanttTask[], pending: PendingDeletion[]): { boardOnly: number; pending: number } {
  return { boardOnly: tasks.filter(t => !t.clickupId).length, pending: pending.length }
}

export const boardPath = (b: BoardRef): string =>
  b.listId ? [b.spaceName, b.folderName].filter(Boolean).join(' / ') : 'Local board, not linked to ClickUp'
