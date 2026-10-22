import { useCallback, useEffect, useState } from 'react'
import type { BoardRef } from '../types'
import type { ProjectRef } from '../lib/portfolioData'
import {
  BOARDS_KEY, boardForList, boardKey, ensureMigrated, listBoard, nextLocalName, removeBoardData,
  type BoardsState,
} from '../lib/boards'

function load(): { state: BoardsState; persist: boolean } {
  try {
    return { state: ensureMigrated(localStorage), persist: true }
  } catch {
    // Storage full while moving the single-board data: it stays under the old
    // keys, and saving no boards lets the next load try again
    return { state: { current: 'unsaved', boards: [{ id: 'unsaved', name: 'My board' }] }, persist: false }
  }
}

// A new board starts with no tasks (only a fresh install gets the example task)
function writeEmpty(id: string) {
  try { localStorage.setItem(boardKey('tasks', id), '[]') } catch { /* quota */ }
}

// The boards kept in this browser and which one is shown. Each board's data
// lives in useTasks / useSyncLog under its id.
export function useBoards() {
  const [init] = useState(load)
  const [state, setState] = useState(init.state)

  useEffect(() => {
    if (!init.persist) return
    try { localStorage.setItem(BOARDS_KEY, JSON.stringify(state)) } catch { /* quota */ }
  }, [state, init.persist])

  const current = state.boards.find(b => b.id === state.current) ?? state.boards[0]

  const switchTo = useCallback((id: string) => {
    const now = new Date().toISOString()
    setState(s => (s.boards.some(b => b.id === id)
      ? { current: id, boards: s.boards.map(b => (b.id === id ? { ...b, openedAt: now } : b)) }
      : s))
  }, [])

  // Switches to the board of that list, creating it when the list has none yet
  const openList = useCallback((ref: ProjectRef): string => {
    const existing = boardForList(state.boards, ref.listId)
    if (existing) {
      switchTo(existing.id)
      return existing.id
    }
    const id = crypto.randomUUID()
    writeEmpty(id)
    setState(s => ({ current: id, boards: [...s.boards, listBoard(id, ref, new Date())] }))
    return id
  }, [state.boards, switchTo])

  const newLocal = useCallback(() => {
    const id = crypto.randomUUID()
    writeEmpty(id)
    setState(s => ({
      current: id,
      boards: [...s.boards, { id, name: nextLocalName(s.boards), openedAt: new Date().toISOString() }],
    }))
  }, [])

  const patch = useCallback((id: string, p: Partial<BoardRef>) => {
    setState(s => ({ ...s, boards: s.boards.map(b => (b.id === id ? { ...b, ...p } : b)) }))
  }, [])

  const rename = useCallback((id: string, name: string) => {
    const n = name.trim()
    if (n) patch(id, { name: n })
  }, [patch])

  // Links a local board to a list no other board uses; the next Push creates
  // its tasks there, or Pull brings the list's tasks in
  const link = useCallback((id: string, ref: ProjectRef) => {
    setState(s => {
      const b = s.boards.find(x => x.id === id)
      if (!b || b.listId || boardForList(s.boards, ref.listId)) return s
      const { openedAt } = b
      return { ...s, boards: s.boards.map(x => (x.id === id ? { ...listBoard(id, ref, new Date()), openedAt } : x)) }
    })
  }, [])

  // Forgets a board and its data in this browser; never the current one
  const remove = useCallback((id: string) => {
    if (id === state.current) return
    removeBoardData(localStorage, id)
    setState(s => ({ ...s, boards: s.boards.filter(b => b.id !== id) }))
  }, [state.current])

  return { boards: state.boards, current, switchTo, openList, newLocal, rename, link, remove, patch }
}

export type BoardsApi = ReturnType<typeof useBoards>
