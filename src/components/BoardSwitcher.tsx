import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardRef } from '../types'
import type { ProjectRef } from '../lib/portfolioData'
import type { WorkspaceTree } from '../hooks/useWorkspaceTree'
import { boardForList, boardPath, recentBoards } from '../lib/boards'
import { filterTree, type SpaceNode } from '../lib/workspace'
import { timeAgo } from '../lib/dates'

interface Props {
  boards: BoardRef[]
  current: BoardRef
  connected: boolean
  workspace: WorkspaceTree
  // Why switching is off right now (a pull / push is running or waiting)
  blocked?: string
  onSwitch: (id: string) => void
  onOpenList: (ref: ProjectRef) => void
  onNewLocal: () => void
  onRename: (id: string) => void
  onRemove: (id: string) => void
  onLink: () => void
  onConnect: () => void
}

function syncedLabel(b: BoardRef, now: number): string {
  if (!b.listId) return 'local only'
  return b.lastSyncAt ? `synced ${timeAgo(b.lastSyncAt, now)}` : 'never synced'
}

// Header dropdown: the boards kept in this browser, then every list of the
// connected workspace (picking one opens it as a board, the first time with a
// pull). Footer: new local board, link the current local board to a list.
export function BoardSwitcher({
  boards, current, connected, workspace, blocked,
  onSwitch, onOpenList, onNewLocal, onRename, onRemove, onLink, onConnect,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const { tree, error, loading, load } = workspace

  useEffect(() => {
    if (open && connected) load()
  }, [open, connected, load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => { if (blocked) setOpen(false) }, [blocked])

  const now = useMemo(() => Date.now(), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase()
  const shownBoards = useMemo(
    () => recentBoards(boards).filter(b => !q || [b.name, boardPath(b)].some(t => t.toLowerCase().includes(q))),
    [boards, q],
  )
  const shownTree = useMemo(() => tree && filterTree(tree, query), [tree, query])

  function close(then: () => void) {
    setOpen(false)
    setQuery('')
    then()
  }

  return (
    <div className="bsw" ref={wrapRef}>
      <button
        type="button"
        className={`bsw__btn${open ? ' bsw__btn--open' : ''}`}
        disabled={!!blocked}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={blocked ?? `${boardPath(current)} · ${syncedLabel(current, Date.now())}. Switch board`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={`bsw__dot${current.listId ? ' bsw__dot--linked' : ''}`} aria-hidden="true" />
        <span className="bsw__name">{current.name}</span>
        <span className="bsw__caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="bsw__pop" role="dialog" aria-label="Switch board">
          <input
            className="bsw__search"
            placeholder={connected ? 'Search boards and ClickUp lists' : 'Search boards'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div className="bsw__scroll">
            <div className="bsw__section">Boards in this browser</div>
            {shownBoards.length === 0 && <div className="bsw__empty">No board matches "{query}".</div>}
            {shownBoards.map(b => {
              const on = b.id === current.id
              return (
                <div key={b.id} className={`bsw__item${on ? ' bsw__item--on' : ''}`}>
                  <button type="button" className="bsw__pick" onClick={() => close(() => { if (!on) onSwitch(b.id) })}>
                    <span className="bsw__check" aria-hidden="true">{on ? '✓' : ''}</span>
                    <span className="bsw__text">
                      <span className="bsw__title">{b.name}</span>
                      <span className="bsw__sub">
                        {b.listId ? `${boardPath(b) || 'ClickUp list'} · ` : ''}{syncedLabel(b, now)}
                      </span>
                    </span>
                  </button>
                  {!b.listId && (
                    <button type="button" className="bsw__act" title="Rename board" aria-label={`Rename ${b.name}`}
                      onClick={() => onRename(b.id)}>✎</button>
                  )}
                  {!on && (
                    <button type="button" className="bsw__act bsw__act--danger" title="Remove from this browser"
                      aria-label={`Remove ${b.name}`} onClick={() => onRemove(b.id)}>✕</button>
                  )}
                </div>
              )
            })}

            {connected ? (
              <>
                <div className="bsw__section">
                  ClickUp lists
                  <button type="button" className="bsw__reload" title="Load the workspace again"
                    onClick={() => load(true)} disabled={loading}>↻</button>
                </div>
                {loading && !tree && <div className="bsw__empty">Loading workspace…</div>}
                {error && <div className="bsw__empty bsw__empty--err">Could not load the workspace: {error}</div>}
                {shownTree && shownTree.length === 0 && (
                  <div className="bsw__empty">{q ? `No list matches "${query}".` : 'No lists in this workspace.'}</div>
                )}
                {shownTree && (
                  <ListTree tree={shownTree} boards={boards} currentId={current.id}
                    onPick={ref => close(() => onOpenList(ref))} />
                )}
              </>
            ) : (
              <div className="bsw__connect">
                Connect ClickUp to open its lists as boards.
                <button type="button" className="bsw__foot-btn" onClick={() => close(onConnect)}>Connect ClickUp</button>
              </div>
            )}
          </div>
          <div className="bsw__foot">
            <button type="button" className="bsw__foot-btn" onClick={() => close(onNewLocal)}>+ New local board</button>
            {connected && !current.listId && (
              <button type="button" className="bsw__foot-btn" onClick={() => close(onLink)}
                title="Pull then brings the list's tasks in, Push creates this board's tasks there">
                Link to ClickUp list…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Space > folder > list. In link mode (`linking`) a list that already has a
// board cannot be picked; otherwise picking it switches to that board.
function ListTree({ tree, boards, currentId, onPick, linking }: {
  tree: SpaceNode[]
  boards: BoardRef[]
  currentId: string
  onPick: (ref: ProjectRef) => void
  linking?: boolean
}) {
  return (
    <div className="bsw__tree">
      {tree.map(s => (
        <div key={s.id}>
          <div className="bsw__space">{s.name}</div>
          {s.groups.map(g => (
            <div key={g.id}>
              <div className="bsw__folder">{g.name ?? 'Lists without folder'}</div>
              {g.lists.map(l => {
                const b = boardForList(boards, l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="bsw__list"
                    disabled={linking && !!b}
                    title={b ? (linking ? `Already the board "${b.name}"` : 'Switch to this board') : 'Open as a board'}
                    onClick={() => onPick({ listId: l.id, name: l.name, spaceId: s.id, spaceName: s.name, folderName: g.name })}
                  >
                    <span className="bsw__list-name">{l.name}</span>
                    {b && <span className="bsw__tag">{b.id === currentId ? 'current' : 'open'}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Links the current local board to a list that has no board yet
export function LinkBoardDialog({ board, boards, workspace, onLink, onClose }: {
  board: BoardRef
  boards: BoardRef[]
  workspace: WorkspaceTree
  onLink: (ref: ProjectRef) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { tree, error, loading, load } = workspace
  const shownTree = useMemo(() => tree && filterTree(tree, query), [tree, query])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="exp-modal bsw-link" role="dialog" aria-modal="true" aria-label="Link board to a ClickUp list"
        onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h2 className="exp-title">Link "{board.name}" to a ClickUp list</h2>
          <div className="exp-head-spacer" />
          <button type="button" className="exp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="bsw-link__hint">
          Nothing is written yet. Pull then brings the list's tasks onto this board, Push creates this
          board's tasks in the list.
        </p>
        <div className="bsw-link__search">
          <input className="exp-input" placeholder="Search lists, folders, spaces" value={query}
            onChange={e => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="bsw-link__body">
          {loading && !tree && <p className="bsw__empty">Loading workspace…</p>}
          {error && (
            <p className="exp-err">
              Could not load the workspace: {error}{' '}
              <button type="button" className="exp-btn" onClick={() => load(true)}>Retry</button>
            </p>
          )}
          {shownTree?.length === 0 && <p className="bsw__empty">No list matches "{query}".</p>}
          {shownTree && <ListTree tree={shownTree} boards={boards} currentId={board.id} onPick={onLink} linking />}
        </div>
        <div className="exp-foot">
          <div className="exp-head-spacer" />
          <button type="button" className="exp-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
