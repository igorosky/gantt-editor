import type { ClickUpConfig, GanttTask, SyncBase, SyncFieldChange, SyncLogEntry } from '../types'
import { buildTree, ancestors, TOP_LEVEL_BLOCKED } from './tree'
import { fmtDate } from './dates'
import { clipText } from './syncLog'
import {
  addDependency,
  addTagToTask,
  createTask,
  fromClickUpDate,
  MILESTONE_ITEM_ID,
  removeDependency,
  removeTagFromTask,
  toClickUpDate,
  updateTask,
  type RemoteTask,
  type UpdateTaskBody,
} from './clickup'

// Two one-way operations instead of a merge:
//   pull: ClickUp wins. The board takes ClickUp's fields, hierarchy and
//         dependencies; nothing is written to ClickUp.
//   push: the board wins. ClickUp takes the board's fields, hierarchy and
//         dependencies; the board only learns new ClickUp ids.
// The caller fetches the list first, so findConflicts (conflicts.ts) can let
// the user decide each change from the other side before anything is
// overwritten. Those decisions come back as Overrides. Both operations record
// syncBase, the state both sides agree on, for the next three-way check.

const isRemoteMilestone = (r: RemoteTask): boolean => r.custom_item_id === MILESTONE_ITEM_ID

const remotePriority = (r: RemoteTask): GanttTask['priority'] =>
  r.priority?.orderindex ? (Number(r.priority.orderindex) as 1 | 2 | 3 | 4) : undefined

const remoteEstimate = (r: RemoteTask): number | undefined =>
  typeof r.time_estimate === 'number' && r.time_estimate > 0 ? r.time_estimate : undefined

// Fresh local row for a remote task. A remote milestone collapses start / end
// onto its due date. Dependencies are left to the caller, since they need the
// clickupId -> local id mapping.
export function mapRemoteTask(r: RemoteTask, id: string): GanttTask {
  const remoteIsMs = isRemoteMilestone(r)
  const rStart = fromClickUpDate(r.start_date)
  const rEnd = fromClickUpDate(r.due_date)
  const msDate = rEnd ?? rStart
  return {
    id,
    clickupId: r.id,
    name: r.name,
    type: remoteIsMs ? 'milestone' : 'task',
    start: (remoteIsMs ? msDate : rStart) ?? undefined,
    end: (remoteIsMs ? msDate : rEnd) ?? undefined,
    progress: 0,
    status: r.status?.status,
    statusColor: r.status?.color,
    statusType: r.status?.type,
    priority: remotePriority(r),
    assignees: r.assignees?.map(a => ({ id: a.id, username: a.username })),
    tags: r.tags?.map(t => ({ name: t.name, tag_bg: t.tag_bg, tag_fg: t.tag_fg })),
    description: r.description,
    timeEstimate: remoteEstimate(r),
  }
}

// Newest date_updated in a set of remote tasks (ms), 0 when none
export function latestUpdate(remote: RemoteTask[]): number {
  let out = 0
  for (const r of remote) out = Math.max(out, Number(r.date_updated || 0))
  return out
}

// ---------------------------------------------------------------- field diff

export type FieldKey =
  | 'name' | 'type' | 'start' | 'end' | 'status' | 'priority'
  | 'assignees' | 'tags' | 'description' | 'estimate'

export interface FieldDiff {
  key: FieldKey
  label: string
  local: string
  remote: string
}

const PRIORITY_LABEL = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' } as const

const fmtHours = (ms?: number): string =>
  ms ? `${Math.round((ms / 3_600_000) * 10) / 10}h` : ''

export const assigneeIds = (t: GanttTask): number[] =>
  (t.assignees ?? []).map(a => a.id).filter(id => id !== -1)

export const tagNames = (t: GanttTask): string[] => (t.tags ?? []).map(x => x.name)

// `cmp` decides equality, `show` is what the log prints. Dates compare by day,
// so a time-of-day difference (frappe's 23:59:59 ends, ClickUp's 4 am due
// dates) never makes a task look changed. Set fields compare as sorted keys
// (ids / names), joined so the base fingerprint can be split back.
export const FIELDS: Array<{ key: FieldKey; label: string; cmp: (t: GanttTask) => string; show?: (t: GanttTask) => string }> = [
  { key: 'name', label: 'Name', cmp: t => t.name },
  { key: 'type', label: 'Type', cmp: t => (t.type === 'milestone' ? 'Milestone' : 'Task') },
  { key: 'start', label: 'Start', cmp: t => (t.start ? fmtDate(t.start) : '') },
  { key: 'end', label: 'Due', cmp: t => (t.end ? fmtDate(t.end) : '') },
  { key: 'status', label: 'Status', cmp: t => t.status ?? '' },
  { key: 'priority', label: 'Priority', cmp: t => (t.priority ? PRIORITY_LABEL[t.priority] : '') },
  {
    key: 'assignees', label: 'Assignees',
    cmp: t => [...assigneeIds(t)].sort((a, b) => a - b).join(','),
    show: t => (t.assignees ?? []).map(a => a.username).sort().join(', '),
  },
  {
    key: 'tags', label: 'Tags',
    cmp: t => [...tagNames(t)].sort().join('\n'),
    show: t => [...tagNames(t)].sort().join(', '),
  },
  { key: 'description', label: 'Description', cmp: t => t.description ?? '', show: t => clipText(t.description ?? '') },
  { key: 'estimate', label: 'Estimate', cmp: t => fmtHours(t.timeEstimate) },
]

const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]))

export const showField = (key: FieldKey, t: GanttTask): string => {
  const f = FIELD_BY_KEY.get(key)!
  return (f.show ?? f.cmp)(t)
}

// The task properties behind each field, for copying a field from one side
export const FIELD_PROPS: Record<FieldKey, Array<keyof GanttTask>> = {
  name: ['name'],
  type: ['type'],
  start: ['start'],
  end: ['end'],
  status: ['status', 'statusColor', 'statusType'],
  priority: ['priority'],
  assignees: ['assignees'],
  tags: ['tags'],
  description: ['description'],
  estimate: ['timeEstimate'],
}

export function copyFields(from: GanttTask, keys: Iterable<FieldKey>): Partial<GanttTask> {
  const out: Record<string, unknown> = {}
  for (const k of keys) for (const p of FIELD_PROPS[k]) out[p] = from[p]
  return out as Partial<GanttTask>
}

// ------------------------------------------------------------ sync baseline

// FNV-1a: the base keeps a short fingerprint of the description instead of a
// second copy of it
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${s.length}:${(h >>> 0).toString(16)}`
}

export const fieldPrint = (key: FieldKey, t: GanttTask): string => {
  const v = FIELD_BY_KEY.get(key)!.cmp(t)
  return key === 'description' ? hashText(v) : v
}

export const depsPrint = (cuids: Iterable<string>): string => [...new Set(cuids)].sort().join(',')

// What both sides agree on after a pull / push: every synced field (the
// estimate is pull-only) plus the predecessors' ClickUp ids
export function syncBaseOf(t: GanttTask, depCuids?: Iterable<string>): SyncBase {
  const out: SyncBase = {}
  for (const f of FIELDS) {
    if (f.key !== 'estimate') out[f.key] = fieldPrint(f.key, t)
  }
  if (depCuids) out.deps = depsPrint(depCuids)
  return out
}

// A status, priority or description the board never had is not a board edit:
// push does not send it, pull may fill it in
export const boardLacks = (key: FieldKey, l: GanttTask): boolean =>
  (key === 'status' && l.status === undefined) ||
  (key === 'priority' && l.priority === undefined) ||
  (key === 'description' && l.description === undefined)

// A milestone keeps one date, the due date, in start and end
export function normalizeMilestone(t: GanttTask): GanttTask {
  if (t.type !== 'milestone') return t
  const d = t.end ?? t.start
  return { ...t, start: d, end: d }
}

// ------------------------------------------------------------ overrides

// Conflict decisions for one task, applied on top of what a pull or push does
// otherwise. parentId: null = top level. deps: predecessor local id -> keep.
export interface TaskOverride {
  fields?: Partial<GanttTask>
  parentId?: string | null
  deps?: Record<string, boolean>
}

export type Overrides = Map<string, TaskOverride>

function overrideDeps(deps: Iterable<string>, o: Record<string, boolean>): string[] {
  const out = new Set(deps)
  for (const [id, keep] of Object.entries(o)) {
    if (keep) out.add(id)
    else out.delete(id)
  }
  return [...out]
}

export function applyOverride(t: GanttTask, o?: TaskOverride): GanttTask {
  if (!o) return t
  const out = o.fields ? normalizeMilestone({ ...t, ...o.fields }) : { ...t }
  if (o.parentId !== undefined) out.parentId = o.parentId ?? undefined
  if (o.deps) {
    const deps = overrideDeps(out.dependencies ?? [], o.deps)
    out.dependencies = deps.length ? deps : undefined
  }
  return out
}

function diffFields(local: GanttTask, remote: GanttTask): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const f of FIELDS) {
    if (f.cmp(local) === f.cmp(remote)) continue
    const show = f.show ?? f.cmp
    out.push({ key: f.key, label: f.label, local: show(local), remote: show(remote) })
  }
  return out
}

// What a pull turns a linked row into. ClickUp may leave the description out,
// which keeps the local one.
export function pullTarget(l: GanttTask, r: RemoteTask): GanttTask {
  const m = mapRemoteTask(r, l.id)
  return {
    ...l,
    name: m.name,
    type: m.type,
    start: m.start,
    end: m.end,
    status: m.status,
    statusColor: m.statusColor,
    statusType: m.statusType,
    priority: m.priority,
    assignees: m.assignees,
    tags: m.tags,
    description: r.description ?? l.description,
    timeEstimate: m.timeEstimate,
  }
}

export const pullDiff = (l: GanttTask, r: RemoteTask): FieldDiff[] => diffFields(l, pullTarget(l, r))

// Fields a push would send. The estimate is pull-only, and a status, priority
// or description the board never had is not a change to push.
export function pushDiff(l: GanttTask, r: RemoteTask): FieldDiff[] {
  return diffFields(l, mapRemoteTask(r, l.id)).filter(d => d.key !== 'estimate' && !boardLacks(d.key, l))
}

// `from` is the old value at the destination, `to` the new one
const pulled = (d: FieldDiff[]): SyncFieldChange[] => d.map(x => ({ field: x.label, from: x.local, to: x.remote }))
const pushed = (d: FieldDiff[]): SyncFieldChange[] => d.map(x => ({ field: x.label, from: x.remote, to: x.local }))

export const remotePreds = (r: RemoteTask): string[] =>
  (r.dependencies ?? []).filter(d => d.task_id === r.id).map(d => d.depends_on)

export const remoteChangedSince = (r: RemoteTask, lastSyncMs: number): boolean =>
  lastSyncMs === 0 || Number(r.date_updated || 0) > lastSyncMs

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function topoSort(tasks: GanttTask[]): GanttTask[] {
  const ids = new Set(tasks.map(t => t.id))
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const t of tasks) {
    indegree.set(t.id, 0)
    adj.set(t.id, [])
  }
  for (const t of tasks) {
    for (const predId of t.dependencies ?? []) {
      if (!ids.has(predId)) continue
      adj.get(predId)!.push(t.id)
      indegree.set(t.id, indegree.get(t.id)! + 1)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id)
  }
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const result: GanttTask[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(taskById.get(id)!)
    for (const succId of adj.get(id)!) {
      const deg = indegree.get(succId)! - 1
      indegree.set(succId, deg)
      if (deg === 0) queue.push(succId)
    }
  }
  // Append any cyclic remainder
  const inResult = new Set(result.map(t => t.id))
  for (const t of tasks) {
    if (!inResult.has(t.id)) result.push(t)
  }
  return result
}

// Local id <-> ClickUp id over the linked rows whose ClickUp task still exists
export function linkMaps(tasks: GanttTask[], remoteById: Map<string, RemoteTask>) {
  const cuidOf = new Map<string, string>()
  const localOf = new Map<string, string>()
  for (const t of tasks) {
    if (t.clickupId && remoteById.has(t.clickupId)) {
      cuidOf.set(t.id, t.clickupId)
      localOf.set(t.clickupId, t.id)
    }
  }
  return { cuidOf, localOf }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------------- pull

export interface PullResult {
  tasks: GanttTask[]
  entries: SyncLogEntry[]
}

// Pure: the board after copying ClickUp onto it. Linked rows take ClickUp's
// fields, parent and dependencies; rows deleted in ClickUp go; ClickUp-only
// tasks are added; board-only rows are left alone. `overrides` (resolved
// conflicts) replace what ClickUp would set. The base always records
// ClickUp's state, so a value kept or merged on the board is a board edit
// that the next push sends.
export function pullFromClickUp(localTasks: GanttTask[], remote: RemoteTask[], overrides?: Overrides): PullResult {
  const entries: SyncLogEntry[] = []
  const remoteById = new Map(remote.map(r => [r.id, r]))
  const next: GanttTask[] = []
  let unlinked = 0

  for (const l of localTasks) {
    if (!l.clickupId) {
      next.push({ ...l })
      unlinked++
      continue
    }
    const r = remoteById.get(l.clickupId)
    if (!r) {
      entries.push({ kind: 'removed', task: l.name, clickupId: l.clickupId, detail: 'Deleted in ClickUp or moved to another list' })
      continue
    }
    const target = pullTarget(l, r)
    const fields = overrides?.get(l.id)?.fields
    const t = fields ? normalizeMilestone({ ...target, ...fields }) : target
    t.syncBase = syncBaseOf(target, remotePreds(r))
    const diff = diffFields(l, t)
    next.push(t)
    if (diff.length) entries.push({ kind: 'updated', task: t.name, taskId: l.id, clickupId: r.id, changes: pulled(diff) })
  }

  const linked = new Set(next.map(t => t.clickupId).filter((x): x is string => !!x))
  const added = new Set<string>()
  for (const r of remote) {
    if (linked.has(r.id)) continue
    const t = mapRemoteTask(r, crypto.randomUUID())
    t.syncBase = syncBaseOf(t, remotePreds(r))
    next.push(t)
    added.add(t.id)
    entries.push({ kind: 'added', task: t.name, taskId: t.id, clickupId: r.id })
  }

  const { cuidOf, localOf } = linkMaps(next, remoteById)
  const nameOf = new Map(next.map(t => [t.id, t.name]))

  // Hierarchy: every linked row takes its ClickUp parent. A parent outside
  // this list leaves the row at the top level.
  for (const t of next) {
    const r = t.clickupId ? remoteById.get(t.clickupId) : undefined
    if (!r) continue
    const remoteP = r.parent ?? null
    const kept = overrides?.get(t.id)?.parentId
    const parentId = kept !== undefined ? kept ?? undefined : remoteP ? localOf.get(remoteP) : undefined
    if (parentId !== t.parentId && !added.has(t.id)) {
      entries.push({
        kind: 'moved', task: t.name, taskId: t.id, clickupId: r.id,
        changes: [{
          field: 'Parent',
          from: t.parentId ? nameOf.get(t.parentId) ?? '' : 'Top level',
          to: parentId ? nameOf.get(parentId) ?? '' : 'Top level',
        }],
      })
    }
    t.parentId = parentId
    t.remoteParent = remoteP
  }

  // A parent that left the board leaves its subtasks at the top level
  const nextIds = new Set(next.map(t => t.id))
  for (const t of next) {
    if (t.parentId && !nextIds.has(t.parentId)) t.parentId = undefined
  }

  // Dependencies of linked rows mirror ClickUp. Edges to board-only rows stay,
  // since ClickUp cannot have them yet.
  for (const t of next) {
    const r = t.clickupId ? remoteById.get(t.clickupId) : undefined
    if (!r) continue
    const fromClickUp = remotePreds(r).map(c => localOf.get(c)).filter((x): x is string => !!x)
    const od = overrides?.get(t.id)?.deps
    const want = new Set((od ? overrideDeps(fromClickUp, od) : fromClickUp).filter(id => nextIds.has(id)))
    const before = t.dependencies ?? []
    const kept = before.filter(id => want.has(id) || (!cuidOf.has(id) && nextIds.has(id)))
    for (const id of before) {
      if (cuidOf.has(id) && !want.has(id)) {
        entries.push({ kind: 'dep-removed', task: t.name, taskId: t.id, clickupId: r.id, detail: `no longer waits on "${nameOf.get(id)}"` })
      }
    }
    const fresh = [...want].filter(id => !before.includes(id))
    for (const id of fresh) {
      entries.push({ kind: 'dep-added', task: t.name, taskId: t.id, clickupId: r.id, detail: `waits on "${nameOf.get(id)}"` })
    }
    const deps = [...kept, ...fresh]
    t.dependencies = deps.length ? deps : undefined
  }

  if (unlinked) {
    entries.push({ kind: 'info', detail: `${plural(unlinked, 'board task')} not in ClickUp yet; Push creates them` })
  }

  // New rows go last, in dependency order
  const existingIds = new Set(localTasks.map(t => t.id))
  const tasks = [
    ...next.filter(t => existingIds.has(t.id)),
    ...topoSort(next.filter(t => !existingIds.has(t.id))),
  ]
  return { tasks, entries }
}

// ---------------------------------------------------------------------- push

export interface PushResult {
  // Per local id: new ClickUp links, sync baselines, and the values resolved
  // conflicts give the board
  patches: Map<string, Partial<GanttTask>>
  entries: SyncLogEntry[]
  // Newest date_updated among ClickUp's write responses (ms), 0 when none
  latestUpdate: number
}

// Copies the board onto ClickUp: changed fields of linked rows, new tasks for
// board-only rows (parents first), parents, and dependencies (added and
// removed). A task deleted in ClickUp is not recreated. `overrides` (resolved
// conflicts) are applied to the board first, so ClickUp and the board both
// end up with the decided values.
export async function pushToClickUp(
  config: Pick<ClickUpConfig, 'token' | 'listId'>,
  boardTasks: GanttTask[],
  remote: RemoteTask[],
  overrides?: Overrides,
): Promise<PushResult> {
  const { token, listId } = config
  const entries: SyncLogEntry[] = []
  const patches = new Map<string, Partial<GanttTask>>()
  const patch = (id: string, p: Partial<GanttTask>) => patches.set(id, { ...patches.get(id), ...p })
  const localTasks = overrides?.size ? boardTasks.map(t => applyOverride(t, overrides.get(t.id))) : boardTasks
  for (const t of localTasks) {
    const o = overrides?.get(t.id)
    if (!o) continue
    const props = new Set(Object.keys(o.fields ?? {}) as Array<keyof GanttTask>)
    if (o.fields && t.type === 'milestone') props.add('start').add('end')
    if (o.parentId !== undefined) props.add('parentId')
    if (o.deps) props.add('dependencies')
    patch(t.id, Object.fromEntries([...props].map(p => [p, t[p]])) as Partial<GanttTask>)
  }
  // Agreed field fingerprints per local id; a failed update keeps the old ones
  const fieldBase = new Map<string, SyncBase>()
  let latest = 0
  const seen = (r?: RemoteTask) => { latest = Math.max(latest, Number(r?.date_updated || 0)) }
  const remoteById = new Map(remote.map(r => [r.id, r]))
  const tree = buildTree(localTasks)
  const { cuidOf, localOf } = linkMaps(localTasks, remoteById)
  const nameOf = new Map(localTasks.map(t => [t.id, t.name]))
  const unlinked: GanttTask[] = []

  // Fields of linked rows
  for (const l of localTasks) {
    if (!l.clickupId) {
      unlinked.push(l)
      continue
    }
    const r = remoteById.get(l.clickupId)
    if (!r) {
      entries.push({
        kind: 'skipped', task: l.name, taskId: l.id, clickupId: l.clickupId,
        detail: 'Not in this ClickUp list any more; Pull removes it from the board',
      })
      continue
    }
    const diff = pushDiff(l, r)
    const keys = new Set(diff.map(d => d.key))
    // ClickUp after this update: the pushed fields from the board, the rest as it was
    const agreed = syncBaseOf({ ...mapRemoteTask(r, l.id), ...copyFields(l, keys) })
    if (!diff.length) {
      fieldBase.set(l.id, agreed)
      continue
    }
    const body: Partial<UpdateTaskBody> = {}
    if (keys.has('name')) body.name = l.name
    // Only sent on a real type flip, so other custom task types in the
    // workspace are never overwritten
    if (keys.has('type')) body.custom_item_id = l.type === 'milestone' ? MILESTONE_ITEM_ID : null
    if (keys.has('start')) {
      body.start_date = l.start ? toClickUpDate(l.start) : null
      if (l.start) body.start_date_time = false
    }
    if (keys.has('end')) {
      body.due_date = l.end ? toClickUpDate(l.end) : null
      if (l.end) body.due_date_time = false
    }
    if (keys.has('status')) body.status = l.status
    if (keys.has('priority')) body.priority = l.priority
    if (keys.has('description')) body.description = l.description
    if (keys.has('assignees')) {
      const localIds = new Set(assigneeIds(l))
      const remoteIds = new Set((r.assignees ?? []).map(a => a.id))
      body.assignees = {
        add: [...localIds].filter(id => !remoteIds.has(id)),
        rem: [...remoteIds].filter(id => !localIds.has(id)),
      }
    }
    const localTags = new Set(tagNames(l))
    const remoteTags = new Set((r.tags ?? []).map(t => t.name))
    try {
      if (Object.keys(body).length) seen(await updateTask(token, r.id, body))
      if (keys.has('tags')) {
        await Promise.all([
          ...[...localTags].filter(n => !remoteTags.has(n)).map(n => addTagToTask(token, r.id, n)),
          ...[...remoteTags].filter(n => !localTags.has(n)).map(n => removeTagFromTask(token, r.id, n)),
        ])
      }
      fieldBase.set(l.id, agreed)
      entries.push({ kind: 'updated', task: l.name, taskId: l.id, clickupId: r.id, changes: pushed(diff) })
    } catch (e) {
      entries.push({ kind: 'error', task: l.name, taskId: l.id, clickupId: r.id, detail: `Update failed: ${errText(e)}` })
    }
  }

  // New ClickUp tasks for board-only rows. Parents go first so a new subtask
  // can name its (possibly just created) parent.
  const depth = (t: GanttTask) => ancestors(t.id, tree).length
  for (const u of [...unlinked].sort((a, b) => depth(a) - depth(b))) {
    const parentLocal = tree.parent.get(u.id)
    const parent = parentLocal ? cuidOf.get(parentLocal) : undefined
    try {
      const ids = assigneeIds(u)
      const created = await createTask(token, listId, {
        name: u.name,
        ...(u.type === 'milestone' ? { custom_item_id: MILESTONE_ITEM_ID } : {}),
        ...(u.start ? { start_date: toClickUpDate(u.start), start_date_time: false } : {}),
        ...(u.end ? { due_date: toClickUpDate(u.end), due_date_time: false } : {}),
        ...(u.priority !== undefined ? { priority: u.priority } : {}),
        ...(u.description !== undefined ? { description: u.description } : {}),
        ...(ids.length ? { assignees: ids } : {}),
        ...(parent ? { parent } : {}),
      })
      seen(created)
      // The create response may omit the parent
      remoteById.set(created.id, { ...created, parent: created.parent ?? parent ?? null, dependencies: [] })
      cuidOf.set(u.id, created.id)
      localOf.set(created.id, u.id)
      patch(u.id, { clickupId: created.id, remoteParent: parent ?? null })
      entries.push({
        kind: 'created', task: u.name, taskId: u.id, clickupId: created.id,
        detail: parent ? `subtask of "${nameOf.get(parentLocal!)}"` : undefined,
      })
      const tags: GanttTask['tags'] = []
      for (const tag of u.tags ?? []) {
        try {
          await addTagToTask(token, created.id, tag.name)
          tags.push(tag)
        } catch (e) {
          entries.push({ kind: 'error', task: u.name, taskId: u.id, clickupId: created.id, detail: `Tag "${tag.name}" failed: ${errText(e)}` })
        }
      }
      // The create body has no status, so ClickUp's default is the agreed one
      fieldBase.set(u.id, syncBaseOf({ ...u, ...copyFields(mapRemoteTask(created, u.id), ['status']), tags }))
    } catch (e) {
      entries.push({ kind: 'error', task: u.name, taskId: u.id, detail: `Create failed: ${errText(e)}` })
    }
  }

  // Parents of rows that were already linked. ClickUp cannot turn a subtask
  // into a top-level task, so that case is reported, never sent as null.
  for (const l of localTasks) {
    const r = l.clickupId ? remoteById.get(l.clickupId) : undefined
    if (!r) continue
    const remoteP = r.parent ?? null
    const parentLocal = tree.parent.get(l.id)
    const localP = parentLocal ? cuidOf.get(parentLocal) : null
    if (localP === undefined) continue // parent not in ClickUp (its create failed)
    const outsideList = remoteP !== null && !localOf.has(remoteP)
    if (localP === remoteP || (localP === null && outsideList)) {
      if (l.remoteParent !== remoteP) patch(l.id, { remoteParent: remoteP })
      continue
    }
    if (localP === null) {
      entries.push({ kind: 'error', task: l.name, taskId: l.id, clickupId: r.id, detail: TOP_LEVEL_BLOCKED })
      continue
    }
    try {
      seen(await updateTask(token, r.id, { parent: localP }))
      patch(l.id, { remoteParent: localP })
      entries.push({
        kind: 'moved', task: l.name, taskId: l.id, clickupId: r.id,
        changes: [{
          field: 'Parent',
          from: remoteP ? remoteById.get(remoteP)?.name ?? '' : 'Top level',
          to: nameOf.get(parentLocal!) ?? '',
        }],
      })
    } catch (e) {
      entries.push({ kind: 'error', task: l.name, taskId: l.id, clickupId: r.id, detail: `Moving under "${nameOf.get(parentLocal!)}" failed: ${errText(e)}` })
    }
  }

  // Dependencies mirror the board. Remote edges to tasks that are not on the
  // board are left alone. The base takes ClickUp's edges after the writes.
  for (const t of localTasks) {
    const cuid = cuidOf.get(t.id)
    if (!cuid) continue
    const have = new Set(remotePreds(remoteById.get(cuid)!))
    const after = new Set(have)
    const want = new Set((t.dependencies ?? []).map(id => cuidOf.get(id)).filter((x): x is string => !!x))
    for (const pred of want) {
      if (have.has(pred)) continue
      const predName = nameOf.get(localOf.get(pred)!)
      try {
        await addDependency(token, cuid, pred)
        after.add(pred)
        entries.push({ kind: 'dep-added', task: t.name, taskId: t.id, clickupId: cuid, detail: `waits on "${predName}"` })
      } catch (e) {
        entries.push({ kind: 'error', task: t.name, taskId: t.id, clickupId: cuid, detail: `Dependency on "${predName}" failed: ${errText(e)}` })
      }
    }
    for (const pred of have) {
      if (want.has(pred) || !localOf.has(pred)) continue
      const predName = nameOf.get(localOf.get(pred)!)
      try {
        await removeDependency(token, cuid, pred)
        after.delete(pred)
        entries.push({ kind: 'dep-removed', task: t.name, taskId: t.id, clickupId: cuid, detail: `no longer waits on "${predName}"` })
      } catch (e) {
        entries.push({ kind: 'error', task: t.name, taskId: t.id, clickupId: cuid, detail: `Removing dependency on "${predName}" failed: ${errText(e)}` })
      }
    }
    patch(t.id, { syncBase: { ...(fieldBase.get(t.id) ?? t.syncBase), deps: depsPrint(after) } })
  }

  const remoteOnly = remote.filter(r => !localOf.has(r.id)).length
  if (remoteOnly) {
    entries.push({ kind: 'info', detail: `${plural(remoteOnly, 'ClickUp task')} not on the board; Pull adds them` })
  }

  return { patches, entries, latestUpdate: latest }
}
