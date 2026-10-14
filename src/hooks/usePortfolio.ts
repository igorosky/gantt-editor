import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClickUpConfig, GanttTask } from '../types'
import {
  demoProjects, deserializeCache, fetchProjects, fromBoardTask, projectColor, serializeCache,
  type PortfolioCache, type PortfolioProject, type ProjectRef,
} from '../lib/portfolioData'

const CONFIG_KEY = 'portfolio-config'
const CACHE_KEY = 'portfolio-cache'

// Project id used for the board when it is not linked to a ClickUp list
export const LOCAL_BOARD_ID = 'board'

interface PortfolioConfig {
  refs: ProjectRef[]
  hidden: string[]
}

function loadConfig(): PortfolioConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<PortfolioConfig>
      return { refs: Array.isArray(p.refs) ? p.refs : [], hidden: Array.isArray(p.hidden) ? p.hidden : [] }
    }
  } catch { /* malformed entry */ }
  return { refs: [], hidden: [] }
}

function loadCache(): PortfolioCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return deserializeCache(raw)
  } catch { /* malformed entry */ }
  return {}
}

export interface Progress {
  done: number
  total: number
}

// Read-only portfolio state. The current board's list always comes from the
// live board tasks, never from the cache, so unsynced edits show up too.
export function usePortfolio(boardTasks: GanttTask[], cu: ClickUpConfig | null) {
  const [config, setConfig] = useState<PortfolioConfig>(loadConfig)
  const [cache, setCache] = useState<PortfolioCache>(loadCache)
  const [demo, setDemo] = useState<PortfolioProject[] | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const boardListId = cu?.listId || undefined
  const canFetch = !!cu?.token

  useEffect(() => {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)) } catch { /* quota */ }
  }, [config])

  useEffect(() => {
    try {
      localStorage.setItem(CACHE_KEY, serializeCache(cache))
      setNotice(null)
    } catch {
      setNotice('Fetched data is too large for browser storage; it is kept for this session only.')
    }
  }, [cache])

  const projects = useMemo<PortfolioProject[]>(() => {
    if (demo) return demo
    const board = (ref: ProjectRef, i: number): PortfolioProject => ({
      ref, color: projectColor(i), isCurrentBoard: true,
      tasks: boardTasks.map(t => fromBoardTask(t, ref.listId)),
    })
    if (config.refs.length === 0) {
      return [board({ listId: boardListId ?? LOCAL_BOARD_ID, name: 'Current board' }, 0)]
    }
    return config.refs.map((ref, i) => {
      if (ref.listId === boardListId) return board(ref, i)
      const c = cache[ref.listId]
      return {
        ref, color: projectColor(i), isCurrentBoard: false,
        tasks: c?.tasks ?? [], fetchedAt: c?.fetchedAt, error: c?.error,
      }
    })
  }, [demo, config.refs, cache, boardTasks, boardListId])

  const hidden = useMemo(() => new Set(config.hidden), [config.hidden])
  const visible = useMemo(() => projects.filter(p => !hidden.has(p.ref.listId)), [projects, hidden])

  // Lists picked but never fetched (or dropped from the cache)
  const missing = useMemo(
    () => (demo ? [] : config.refs.filter(r => r.listId !== boardListId && !cache[r.listId])),
    [demo, config.refs, cache, boardListId],
  )

  const toggleHidden = useCallback((listId: string) => {
    setConfig(prev => ({
      ...prev,
      hidden: prev.hidden.includes(listId) ? prev.hidden.filter(id => id !== listId) : [...prev.hidden, listId],
    }))
  }, [])

  const setRefs = useCallback((refs: ProjectRef[]) => {
    const ids = new Set(refs.map(r => r.listId))
    setConfig(prev => ({ refs, hidden: prev.hidden.filter(id => ids.has(id)) }))
    setCache(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
  }, [])

  const refresh = useCallback(async (only?: string[]) => {
    if (!cu?.token || progress) return
    const ids = (only ?? config.refs.map(r => r.listId)).filter(id => id !== boardListId)
    if (ids.length === 0) return
    setProgress({ done: 0, total: ids.length })
    try {
      const res = await fetchProjects(cu.token, ids, (done, total) => setProgress({ done, total }))
      const now = new Date().toISOString()
      setCache(prev => {
        const next = { ...prev }
        for (const id of ids) {
          const r = res[id]
          // A failed list keeps its last good data, flagged with the error
          next[id] = r.error
            ? { tasks: prev[id]?.tasks ?? [], fetchedAt: prev[id]?.fetchedAt, error: r.error }
            : { tasks: r.tasks ?? [], fetchedAt: now }
        }
        return next
      })
      setConfig(prev => ({
        ...prev,
        refs: prev.refs.map(ref => {
          const name = res[ref.listId]?.listName
          return name && name !== ref.name ? { ...ref, name } : ref
        }),
      }))
    } finally {
      setProgress(null)
    }
  }, [cu?.token, progress, config.refs, boardListId])

  const loadDemo = useCallback(() => setDemo(demoProjects(new Date())), [])
  const exitDemo = useCallback(() => setDemo(null), [])

  return {
    projects, visible, hidden, toggleHidden,
    refs: config.refs, setRefs, missing,
    refresh, progress, notice, canFetch, boardListId,
    isDemo: !!demo, loadDemo, exitDemo,
  }
}

export type PortfolioState = ReturnType<typeof usePortfolio>
