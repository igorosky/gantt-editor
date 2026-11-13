import { useEffect, useState } from 'react'
import { getListStatuses, type ClickUpStatus } from '../lib/clickup'

// One request per list (and token) for the whole app: the board, the task
// popup's status picker and the status filter share it. A failed request is
// forgotten, so the next caller tries again.
const cache = new Map<string, Promise<ClickUpStatus[]>>()

export function fetchListStatuses(token: string, listId: string): Promise<ClickUpStatus[]> {
  const key = `${token}\u0000${listId}`
  let p = cache.get(key)
  if (!p) {
    p = getListStatuses(token, listId).catch(e => {
      cache.delete(key)
      throw e
    })
    cache.set(key, p)
  }
  return p
}

export interface ListStatuses {
  statuses: ClickUpStatus[] | undefined // undefined until loaded (or without a list)
  error: string | null
}

// The statuses of a linked board's list
export function useListStatuses(token: string | undefined, listId: string | undefined): ListStatuses {
  const key = token && listId ? `${token}\u0000${listId}` : ''
  const [state, setState] = useState<{ key: string; statuses?: ClickUpStatus[]; error: string | null }>({ key: '', error: null })
  useEffect(() => {
    if (!token || !listId) return
    let live = true
    fetchListStatuses(token, listId)
      .then(statuses => { if (live) setState({ key, statuses, error: null }) })
      .catch(e => { if (live) setState({ key, error: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key && key ? { statuses: state.statuses, error: state.error } : { statuses: undefined, error: null }
}
