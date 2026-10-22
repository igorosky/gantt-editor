import { useCallback, useEffect, useState } from 'react'
import type { SyncReport } from '../types'
import { capRun } from '../lib/syncLog'
import { boardKey } from '../lib/boards'

const MAX_RUNS = 20

function load(boardId: string): SyncReport[] {
  try {
    const raw = localStorage.getItem(boardKey('log', boardId))
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) {
        return p.filter((r): r is SyncReport => !!r && typeof r === 'object' && Array.isArray((r as SyncReport).entries))
      }
    }
  } catch { /* malformed entry */ }
  return []
}

// Pull / push history of one board, newest first. A quota failure keeps it in
// memory only. Switching boardId loads that board's log in the same render.
export function useSyncLog(boardId: string) {
  const [log, setLog] = useState(() => ({ boardId, runs: load(boardId) }))
  let current = log
  if (log.boardId !== boardId) {
    current = { boardId, runs: load(boardId) }
    setLog(current)
  }

  useEffect(() => {
    try {
      localStorage.setItem(boardKey('log', log.boardId), JSON.stringify(log.runs))
    } catch { /* quota */ }
  }, [log])

  const addRun = useCallback((run: Omit<SyncReport, 'id'>) => {
    setLog(l => ({ ...l, runs: [capRun({ ...run, id: crypto.randomUUID() }), ...l.runs].slice(0, MAX_RUNS) }))
  }, [])

  const clear = useCallback(() => setLog(l => ({ ...l, runs: [] })), [])

  return { runs: current.runs, addRun, clear }
}
