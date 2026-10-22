import { useCallback, useEffect, useRef, useState } from 'react'
import { loadWorkspaceTree, type SpaceNode } from '../lib/workspace'

// Space > Folder > List of the connected workspace, loaded on first use and
// kept until the connection changes. A failed load stays failed until
// load(true), so an effect calling load() never loops on errors.
export function useWorkspaceTree(token: string | undefined, teamId: string | undefined) {
  const [tree, setTree] = useState<SpaceNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Bumped on every load and connection change; older responses are dropped
  const gen = useRef(0)

  useEffect(() => {
    gen.current++
    setTree(null)
    setError(null)
    setLoading(false)
  }, [token, teamId])

  const load = useCallback((force = false) => {
    if (!token || !teamId) return
    if (!force && (tree || loading || error)) return
    const g = ++gen.current
    setLoading(true)
    setError(null)
    loadWorkspaceTree(token, teamId)
      .then(t => { if (gen.current === g) setTree(t) })
      .catch(e => { if (gen.current === g) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (gen.current === g) setLoading(false) })
  }, [token, teamId, tree, loading, error])

  return { tree, error, loading, load }
}

export type WorkspaceTree = ReturnType<typeof useWorkspaceTree>
