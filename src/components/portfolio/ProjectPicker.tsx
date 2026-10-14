import { useEffect, useMemo, useState } from 'react'
import {
  listFolderlessLists, listFolders, listLists, listSpaces, type List,
} from '../../lib/clickup'
import type { ProjectRef } from '../../lib/portfolioData'

interface Props {
  token: string
  teamId: string
  boardListId?: string
  refs: ProjectRef[]
  onSave: (refs: ProjectRef[]) => void
  onClose: () => void
}

interface SpaceNode {
  id: string
  name: string
  groups: Array<{ id: string; name?: string; lists: List[] }> // name undefined = folderless
}

export function ProjectPicker({ token, teamId, boardListId, refs, onSave, onClose }: Props) {
  const [tree, setTree] = useState<SpaceNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => {
    const ids = new Set(refs.map(r => r.listId))
    if (ids.size === 0 && boardListId) ids.add(boardListId)
    return ids
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const spaces = await listSpaces(token, teamId)
        const nodes = await Promise.all(spaces.map(async (s): Promise<SpaceNode> => {
          const [folders, folderless] = await Promise.all([listFolders(token, s.id), listFolderlessLists(token, s.id)])
          const groups: SpaceNode['groups'] = await Promise.all(folders.map(async f => ({
            id: f.id, name: f.name as string | undefined, lists: f.lists ?? await listLists(token, f.id),
          })))
          if (folderless.length) groups.unshift({ id: `${s.id}:folderless`, name: undefined, lists: folderless })
          return { id: s.id, name: s.name, groups }
        }))
        if (!cancelled) setTree(nodes)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    return () => { cancelled = true }
  }, [token, teamId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.key === 'Escape' && tag !== 'INPUT') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Every list in the tree as a ProjectRef, in tree order
  const allRefs = useMemo(() => {
    const out = new Map<string, ProjectRef>()
    for (const s of tree ?? []) for (const g of s.groups) for (const l of g.lists) {
      out.set(l.id, { listId: l.id, name: l.name, spaceName: s.name, folderName: g.name })
    }
    return out
  }, [tree])

  const q = query.trim().toLowerCase()
  const visibleTree = useMemo(() => {
    if (!tree || !q) return tree
    return tree.map(s => ({
      ...s,
      groups: s.groups.map(g => ({
        ...g,
        lists: g.lists.filter(l => [l.name, g.name ?? '', s.name].some(t => t.toLowerCase().includes(q))),
      })).filter(g => g.lists.length),
    })).filter(s => s.groups.length)
  }, [tree, q])

  function toggle(ids: string[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function save() {
    // Keep the existing order (it decides each project's color), append new
    // picks in tree order. Lists no longer in the tree keep their old ref.
    const kept = refs.filter(r => selected.has(r.listId)).map(r => allRefs.get(r.listId) ?? r)
    const keptIds = new Set(kept.map(r => r.listId))
    const added = [...allRefs.values()].filter(r => selected.has(r.listId) && !keptIds.has(r.listId))
    onSave([...kept, ...added])
  }

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="exp-modal pf-picker" role="dialog" aria-modal="true" aria-label="Choose projects"
        onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h2 className="exp-title">Projects in portfolio</h2>
          <div className="exp-head-spacer" />
          <button type="button" className="exp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pf-picker__search">
          <input className="exp-input" placeholder="Search lists, folders, spaces" value={query}
            onChange={e => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="pf-picker__body">
          {error && <p className="exp-err">Could not load the workspace: {error}</p>}
          {!tree && !error && <p className="pf-muted">Loading workspace…</p>}
          {visibleTree?.length === 0 && <p className="pf-muted">No list matches "{query}".</p>}
          {visibleTree?.map(s => (
            <div key={s.id} className="pf-picker__space">
              <div className="pf-picker__space-name">{s.name}</div>
              {s.groups.map(g => {
                const ids = g.lists.map(l => l.id)
                const n = ids.filter(id => selected.has(id)).length
                return (
                  <div key={g.id} className="pf-picker__group">
                    <label className="exp-check pf-picker__folder">
                      <input type="checkbox" checked={n === ids.length && n > 0}
                        ref={el => { if (el) el.indeterminate = n > 0 && n < ids.length }}
                        onChange={e => toggle(ids, e.target.checked)} />
                      {g.name ?? <em>Lists without folder</em>}
                    </label>
                    {g.lists.map(l => (
                      <label key={l.id} className="exp-check pf-picker__list">
                        <input type="checkbox" checked={selected.has(l.id)}
                          onChange={e => toggle([l.id], e.target.checked)} />
                        {l.name}
                        {l.id === boardListId && <span className="pf-picker__board">current board</span>}
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="exp-foot">
          <span className="pf-muted">{selected.size} selected · read only, nothing is changed in ClickUp</span>
          <div className="exp-head-spacer" />
          <button type="button" className="exp-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="exp-btn exp-btn--primary" onClick={save} disabled={!tree}>Save</button>
        </div>
      </div>
    </div>
  )
}
