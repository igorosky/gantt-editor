import { useEffect, useRef, useState } from 'react'
import type { Assignee, GanttTask, Tag, TaskType } from '../types'
import { getListStatuses, getSpaceTags, listTeamMembers, type ClickUpStatus, type TeamMember } from '../lib/clickup'
import { isMilestone, typeChangePatch } from '../utils'
import { AssigneePicker } from './AssigneePicker'
import { TagPicker } from './TagPicker'
import { DatePicker } from './DatePicker'

interface Props {
  task: GanttTask
  allTasks: GanttTask[]
  onClose: () => void
  onUpdate: (patch: Partial<GanttTask>) => void
  onCommit?: () => void
  isCreateMode?: boolean
  clickupToken?: string
  clickupTeamId?: string
  clickupListId?: string
  clickupSpaceId?: string
}

// Keep in sync with --milestone in App.css and --g-milestone-color in the gantt theme
const MILESTONE_COLOR = '#f5a623'

const PRIORITIES: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#ef4444' },
  2: { label: 'High', color: '#f59e0b' },
  3: { label: 'Normal', color: '#64748b' },
  4: { label: 'Low', color: '#94a3b8' },
}


function getInitials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

function avatarColor(name: string): string {
  const colors = ['#7c85f5', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

function PriorityPill({ value, onChange }: { value: GanttTask['priority']; onChange: (v: GanttTask['priority']) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('mousedown', fn), 0)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  const p = value ? PRIORITIES[value] : null

  return (
    <div className="tdp-priority-wrap">
      <button
        ref={ref}
        className="tdp-pill"
        style={p ? { color: p.color, borderColor: p.color + '44' } : {}}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        {p ? p.label : 'No priority'}
        <span className="tdp-chev">▾</span>
      </button>
      {open && (
        <div ref={menuRef} className="tdp-menu">
          {([1, 2, 3, 4] as const).map(n => (
            <button
              key={n}
              className={value === n ? 'is-active' : ''}
              onClick={() => { onChange(n); setOpen(false) }}
              type="button"
            >
              <span style={{ color: PRIORITIES[n].color }}>●</span>
              {PRIORITIES[n].label}
            </button>
          ))}
          {value && (
            <>
              <div className="tdp-menu-sep" />
              <button onClick={() => { onChange(undefined); setOpen(false) }} type="button" style={{ color: '#888' }}>
                Clear priority
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TypePill({ value, onChange }: { value: TaskType; onChange: (v: TaskType) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('mousedown', fn), 0)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  const ms = value === 'milestone'

  return (
    <div className="tdp-priority-wrap">
      <button
        ref={ref}
        className="tdp-pill"
        style={ms ? { color: MILESTONE_COLOR, borderColor: MILESTONE_COLOR + '44' } : {}}
        onClick={() => setOpen(o => !o)}
        type="button"
        title="Task type"
      >
        {ms ? '◆ Milestone' : 'Task'}
        <span className="tdp-chev">▾</span>
      </button>
      {open && (
        <div ref={menuRef} className="tdp-menu">
          <button
            className={!ms ? 'is-active' : ''}
            onClick={() => { onChange('task'); setOpen(false) }}
            type="button"
          >
            <span>▬</span>
            Task
          </button>
          <button
            className={ms ? 'is-active' : ''}
            onClick={() => { onChange('milestone'); setOpen(false) }}
            type="button"
          >
            <span style={{ color: MILESTONE_COLOR }}>◆</span>
            Milestone
          </button>
        </div>
      )}
    </div>
  )
}

function StatusSelector({
  value,
  onChange,
  token,
  listId,
  showWhenEmpty,
}: {
  value: string | undefined
  onChange: (s: ClickUpStatus) => void
  token: string | undefined
  listId: string | undefined
  showWhenEmpty?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [statuses, setStatuses] = useState<ClickUpStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const canEdit = !!(token && listId)

  useEffect(() => {
    if (!canEdit || statuses.length > 0 || loading) return
    setLoading(true)
    getListStatuses(token!, listId!)
      .then(s => { setStatuses(s); setError(null) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [canEdit, listId])

  useEffect(() => {
    if (!open || !canEdit) return
    const fn = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const kfn = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    setTimeout(() => document.addEventListener('mousedown', fn), 0)
    document.addEventListener('keydown', kfn)
    return () => {
      document.removeEventListener('mousedown', fn)
      document.removeEventListener('keydown', kfn)
    }
  }, [open, canEdit])

  const handleOpen = () => {
    if (!canEdit) return
    setOpen(o => !o)
  }

  const current = statuses.find(s => s.status === value)
  const badgeStyle = current?.color ? { background: current.color, color: '#fff', borderColor: current.color } : {}

  if (!value && !showWhenEmpty) return null

  if (!canEdit) {
    return <span className="tdp-status-badge">{value}</span>
  }

  return (
    <div className="tdp-status-wrap">
      <button
        ref={ref}
        className={`tdp-status-badge tdp-status-badge--btn${!value ? ' tdp-status-badge--empty' : ''}`}
        style={badgeStyle}
        onClick={handleOpen}
        type="button"
        title="Change status"
      >
        {value ?? <span className="tdp-status-placeholder">Set status</span>}
        <span className="tdp-chev">▾</span>
      </button>
      {open && (
        <div ref={menuRef} className="tdp-menu tdp-status-menu">
          {loading && <div className="tdp-menu-loading">Loading…</div>}
          {error && <div className="tdp-menu-error">{error}</div>}
          {statuses.map(s => (
            <button
              key={s.status}
              className={value === s.status ? 'is-active' : ''}
              onClick={() => { onChange(s); setOpen(false) }}
              type="button"
            >
              <span className="tdp-status-dot" style={{ background: s.color }} />
              {s.status}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskDetailPopup({ task, allTasks, onClose, onUpdate, onCommit, isCreateMode, clickupToken, clickupTeamId, clickupListId, clickupSpaceId }: Props) {
  const [nameDraft, setNameDraft] = useState(task.name)
  const [descDraft, setDescDraft] = useState(task.description ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [spaceTags, setSpaceTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreateMode) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setNameDraft(task.name)
    setDescDraft(task.description ?? '')
  }, [task.id, task.name, task.description])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA') onClose()
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const deps = (task.dependencies ?? [])
    .map(id => allTasks.find(t => t.id === id))
    .filter((t): t is GanttTask => !!t)

  const removeDep = (depId: string) => {
    onUpdate({ dependencies: (task.dependencies ?? []).filter(d => d !== depId) })
  }

  const openPicker = async () => {
    setPickerOpen(true)
    if (members.length === 0 && !membersLoading && !fetchError && clickupToken && clickupTeamId) {
      setMembersLoading(true)
      try {
        setMembers(await listTeamMembers(clickupToken, clickupTeamId))
        setFetchError(null)
      } catch (e) {
        setFetchError(String(e))
      } finally {
        setMembersLoading(false)
      }
    }
  }

  const toggleAssignee = (m: TeamMember) => {
    const cur = task.assignees ?? []
    const exists = cur.some(a => a.id === m.id)
    onUpdate({
      assignees: exists
        ? cur.filter(a => a.id !== m.id)
        : [...cur, { id: m.id, username: m.username ?? m.email }],
    })
  }

  const removeAssignee = (a: Assignee) => {
    onUpdate({
      assignees: (task.assignees ?? []).filter(x => x.id !== a.id || x.username !== a.username),
    })
  }

  const openTagPicker = async () => {
    setTagPickerOpen(true)
    if (spaceTags.length === 0 && !tagsLoading && !tagsError && clickupToken && clickupSpaceId) {
      setTagsLoading(true)
      try {
        setSpaceTags(await getSpaceTags(clickupToken, clickupSpaceId))
        setTagsError(null)
      } catch (e) {
        setTagsError(String(e))
      } finally {
        setTagsLoading(false)
      }
    }
  }

  const toggleTag = (tag: Tag) => {
    const cur = task.tags ?? []
    const exists = cur.some(t => t.name === tag.name)
    onUpdate({
      tags: exists ? cur.filter(t => t.name !== tag.name) : [...cur, tag],
    })
  }

  const removeTag = (tag: Tag) => {
    onUpdate({ tags: (task.tags ?? []).filter(t => t.name !== tag.name) })
  }

  const createTag = (name: string) => {
    const newTag: Tag = { name }
    setSpaceTags(prev => prev.some(t => t.name === name) ? prev : [...prev, newTag])
    toggleTag(newTag)
    setTagPickerOpen(false)
  }

  const clickupUrl = task.clickupId ? `https://app.clickup.com/t/${task.clickupId}` : null
  const ms = isMilestone(task)

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="tdp-modal" role="dialog" aria-modal="true" aria-label={`Task details: ${task.name}`} onClick={e => e.stopPropagation()}>

        {/* Top bar */}
        <div className="tdp-topbar">
          {isCreateMode
            ? <span className="tdp-id tdp-id--draft">{ms ? 'New milestone' : 'New task'}</span>
            : <span className="tdp-id">TASK-{task.id.slice(0, 8).toUpperCase()}</span>
          }
          <StatusSelector
            value={task.status}
            onChange={s => onUpdate({ status: s.status, statusColor: s.color, statusType: s.type })}
            token={clickupToken}
            listId={clickupListId}
            showWhenEmpty={isCreateMode}
          />
          <div className="tdp-topbar-spacer" />
          {clickupUrl && (
            <a className="tdp-iconbtn" href={clickupUrl} target="_blank" rel="noreferrer" title="Open in ClickUp">
              ↗
            </a>
          )}
          <button className="tdp-iconbtn tdp-iconbtn--close" onClick={onClose} title="Close (Esc)" type="button">
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="tdp-body">

          {/* Hero */}
          <div className="tdp-hero">
            <div className="tdp-hero-pills">
              <TypePill
                value={task.type ?? 'task'}
                onChange={v => {
                  const patch = typeChangePatch(task, v)
                  // Keep the placeholder name of an untouched draft in step with its type
                  const auto = v === 'milestone' ? 'New milestone' : 'New task'
                  const stale = v === 'milestone' ? 'New task' : 'New milestone'
                  if (isCreateMode && nameDraft.trim() === stale) {
                    setNameDraft(auto)
                    onUpdate({ ...patch, name: auto })
                    return
                  }
                  onUpdate(patch)
                }}
              />
              <PriorityPill value={task.priority} onChange={v => onUpdate({ priority: v })} />
            </div>
            <input
              ref={titleInputRef}
              className="tdp-title"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={() => { const v = nameDraft.trim(); onUpdate({ name: v || task.name }) }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setNameDraft(task.name)
              }}
            />
          </div>

          {/* Properties grid */}
          <div className="tdp-props">

            {/* Assignees */}
            <div className="tdp-label">Assignees</div>
            <div className="tdp-value tdp-assignees-wrap">
              {(task.assignees ?? []).map(a => (
                <span key={a.id !== -1 ? a.id : a.username} className="tdp-assignee-chip">
                  <span className="tdp-av" style={{ background: avatarColor(a.username) }}>
                    {getInitials(a.username)}
                  </span>
                  {a.username}
                  <span
                    className="tdp-assignee-x"
                    onClick={e => { e.stopPropagation(); removeAssignee(a) }}
                    title="Remove assignee"
                  >
                    ×
                  </span>
                </span>
              ))}
              {clickupToken && (
                <button
                  type="button"
                  className="tdp-add-assignee-btn"
                  onClick={e => { e.stopPropagation(); openPicker() }}
                >
                  + Add
                </button>
              )}
              {pickerOpen && (
                <AssigneePicker
                  members={members}
                  loading={membersLoading}
                  error={fetchError}
                  assigned={task.assignees ?? []}
                  onToggle={toggleAssignee}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>

            {/* Tags */}
            <div className="tdp-label">Tags</div>
            <div className="tdp-value tdp-tags-wrap">
              {(task.tags ?? []).map(tag => (
                <span key={tag.name} className="tdp-tag-chip">
                  <span className="tdp-tag-dot" style={{ background: tag.tag_bg ?? '#888' }} />
                  {tag.name}
                  <span
                    className="tdp-tag-x"
                    onClick={e => { e.stopPropagation(); removeTag(tag) }}
                    title="Remove tag"
                  >
                    ×
                  </span>
                </span>
              ))}
              {clickupToken && clickupSpaceId && (
                <button
                  type="button"
                  className="tdp-add-assignee-btn"
                  onClick={e => { e.stopPropagation(); openTagPicker() }}
                >
                  + Add tag
                </button>
              )}
              {tagPickerOpen && (
                <TagPicker
                  spaceTags={spaceTags}
                  loading={tagsLoading}
                  error={tagsError}
                  selected={task.tags ?? []}
                  onToggle={tag => { toggleTag(tag); setTagPickerOpen(false) }}
                  onCreate={createTag}
                  onClose={() => setTagPickerOpen(false)}
                />
              )}
            </div>

            {/* Dates */}
            <div className="tdp-label">{ms ? 'Date' : 'Dates'}</div>
            <div className="tdp-value">
              {ms ? (
                <DatePicker
                  value={task.end}
                  onChange={d => onUpdate({ start: d, end: d })}
                  title="Milestone date"
                />
              ) : (
                <>
                  <DatePicker
                    value={task.start}
                    onChange={d => onUpdate({ start: d, ...(task.end && d && d > task.end ? { end: d } : {}) })}
                    title="Start date"
                  />
                  <span className="tdp-date-arrow">→</span>
                  <DatePicker
                    value={task.end}
                    onChange={d => onUpdate({ end: d, ...(task.start && d && d < task.start ? { start: d } : {}) })}
                    title="Due date"
                  />
                  {task.start && task.end && (
                    <span className="tdp-date-days">
                      {Math.max(1, Math.round((task.end.getTime() - task.start.getTime()) / (1000 * 60 * 60 * 24)) + 1)} days
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Dependencies */}
            <div className="tdp-label">Depends on</div>
            <div className="tdp-value">
              {deps.length === 0 && <span className="tdp-empty">—</span>}
              {deps.map(d => (
                <span key={d.id} className="tdp-dep-chip">
                  {d.name}
                  <span className="tdp-dep-x" onClick={() => removeDep(d.id)} title="Remove dependency">×</span>
                </span>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="tdp-section">
            <h3>Description</h3>
            <textarea
              className="tdp-desc"
              placeholder="Add a description…"
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              onBlur={() => onUpdate({ description: descDraft })}
            />
          </div>
        </div>
        {isCreateMode && (
          <div className="tdp-footer">
            <button type="button" className="tdp-footer__cancel" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="tdp-footer__create"
              onClick={() => {
                const trimmed = nameDraft.trim()
                if (trimmed && trimmed !== task.name) onUpdate({ name: trimmed })
                onCommit?.()
              }}
            >
              {ms ? 'Create milestone' : 'Create task'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
