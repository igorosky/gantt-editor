import { useCallback, useEffect, useState } from 'react'
import type { SyncReport } from '../types'
import { capRun } from '../lib/syncLog'

const STORAGE_KEY = 'gantt-sync-log'
const MAX_RUNS = 20

function load(): SyncReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) {
        return p.filter((r): r is SyncReport => !!r && typeof r === 'object' && Array.isArray((r as SyncReport).entries))
      }
    }
  } catch { /* malformed entry */ }
  return []
}

// Pull / push history, newest first. A quota failure keeps it in memory only.
export function useSyncLog() {
  const [runs, setRuns] = useState<SyncReport[]>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
    } catch { /* quota */ }
  }, [runs])

  const addRun = useCallback((run: Omit<SyncReport, 'id'>) => {
    setRuns(prev => [capRun({ ...run, id: crypto.randomUUID() }), ...prev].slice(0, MAX_RUNS))
  }, [])

  const clear = useCallback(() => setRuns([]), [])

  return { runs, addRun, clear }
}
