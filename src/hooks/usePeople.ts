import { useCallback, useEffect, useMemo, useState } from 'react'
import { listTeamMembers, type TeamMember } from '../lib/clickup'
import type { Person } from '../components/Avatar'

const KEY = (teamId: string) => `clickup-people@${teamId}`
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Cached {
  fetchedAt: number
  members: Person[]
}

function toPerson(m: TeamMember): Person {
  return {
    id: m.id,
    username: m.username ?? m.email,
    email: m.email,
    profilePicture: m.profilePicture ?? null,
    ...(m.color ? { color: m.color } : {}),
  }
}

function readCache(teamId: string): Cached | null {
  try {
    const raw = localStorage.getItem(KEY(teamId))
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Cached>
    if (typeof p.fetchedAt !== 'number' || !Array.isArray(p.members)) return null
    return { fetchedAt: p.fetchedAt, members: p.members.filter(m => m && typeof m.id === 'number' && typeof m.username === 'string') }
  } catch {
    return null
  }
}

export interface People {
  list: Person[]
  byId: ReadonlyMap<number, Person>
  loading: boolean
  error: string | null
  reload: () => void
}

// The workspace's members (for assignee pickers and profile pictures),
// loaded once per connection and cached for a day in localStorage
export function usePeople(token: string | undefined, teamId: string | undefined): People {
  const [state, setState] = useState<{ teamId: string; members: Person[]; loading: boolean; error: string | null }>(
    () => ({ teamId: teamId ?? '', members: (teamId && readCache(teamId)?.members) || [], loading: false, error: null }),
  )
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!token || !teamId) {
      setState({ teamId: '', members: [], loading: false, error: null })
      return
    }
    const cached = readCache(teamId)
    const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE_MS
    setState({ teamId, members: cached?.members ?? [], loading: !fresh || nonce > 0, error: null })
    if (fresh && nonce === 0) return
    let live = true
    listTeamMembers(token, teamId)
      .then(ms => {
        const members = ms.map(toPerson)
        try {
          localStorage.setItem(KEY(teamId), JSON.stringify({ fetchedAt: Date.now(), members }))
        } catch { /* quota: kept in memory */ }
        if (live) setState({ teamId, members, loading: false, error: null })
      })
      .catch(e => {
        if (live) setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
      })
    return () => { live = false }
  }, [token, teamId, nonce])

  const list = state.teamId === teamId ? state.members : []
  const byId = useMemo(() => new Map(list.map(p => [p.id, p])), [list])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { list, byId, loading: state.loading, error: state.error, reload }
}
