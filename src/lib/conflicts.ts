import type { GanttTask, ResolutionUse, SyncDirection, SyncLogEntry, SyncResolvedField } from '../types'
import type { RemoteTask } from './clickup'
import { buildTree } from './tree'
import {
  assigneeIds,
  boardLacks,
  copyFields,
  fieldPrint,
  linkMaps,
  mapRemoteTask,
  pullDiff,
  pullTarget,
  pushDiff,
  remoteChangedSince,
  remotePreds,
  showField,
  tagNames,
  type FieldKey,
  type Overrides,
  type TaskOverride,
} from './sync'

// What a pull or push would overwrite on the other side, one item per field,
// parent or dependency edge, so the user can decide each one. With a sync
// base (GanttTask.syncBase) the check is three-way: pull guards fields the
// board changed since the last pull / push, push guards fields ClickUp
// changed. Without one it falls back to ClickUp's date_updated against
// lastSyncAt for the whole task.

export interface ConflictItem {
  key: string
  label: string
  color?: string
}

export interface SyncConflict {
  id: string
  taskId: string
  task: string
  clickupId: string
  key: FieldKey | 'parent' | 'dep'
  label: string
  // Display values of each side
  board: string
  clickup: string
  // Changed on both sides since the last pull / push; otherwise only the side
  // this run would overwrite changed it
  both: boolean
  // Tags / assignees: every item of either side, each side's keys, and the
  // merge default (three-way with a base, else the union)
  items?: { all: ConflictItem[]; board: string[]; clickup: string[]; merged: string[] }
  // Name / description: full text of each side, for manual editing
  text?: { board: string; clickup: string }
  predId?: string // dep: the predecessor's local id
}

export type Resolution =
  | { use: 'board' }
  | { use: 'clickup' }
  | { use: 'merge'; keys: string[] }
  | { use: 'edit'; text: string }

export const canMerge = (c: SyncConflict): boolean => !!c.items
export const canEdit = (c: SyncConflict): boolean => !!c.text

// The side the operation would pick by itself
export const winner = (direction: SyncDirection): 'board' | 'clickup' =>
  direction === 'pull' ? 'clickup' : 'board'

export function defaultPicks(conflicts: SyncConflict[], direction: SyncDirection): Map<string, Resolution> {
  return new Map(conflicts.map(c => [c.id, { use: winner(direction) }]))
}

const splitBase = (s: string | undefined, sep: string): Set<string> | undefined =>
  s === undefined ? undefined : new Set(s.split(sep).filter(Boolean))

// Keeps an item unless one side removed it since the base; both sides'
// additions stay. Without a base: the union.
export function mergeKeys(board: string[], clickup: string[], base?: Set<string>): string[] {
  const b = new Set(board)
  const c = new Set(clickup)
  return [...new Set([...board, ...clickup])].filter(k =>
    !base ? true : (b.has(k) && c.has(k)) || (b.has(k) && !base.has(k)) || (c.has(k) && !base.has(k)))
}

function setItems(key: 'assignees' | 'tags', l: GanttTask, theirs: GanttTask): SyncConflict['items'] {
  const all = new Map<string, ConflictItem>()
  let board: string[]
  let clickup: string[]
  let base: Set<string> | undefined
  if (key === 'assignees') {
    for (const a of [...(l.assignees ?? []), ...(theirs.assignees ?? [])]) {
      if (a.id !== -1 && !all.has(String(a.id))) all.set(String(a.id), { key: String(a.id), label: a.username })
    }
    board = assigneeIds(l).map(String)
    clickup = assigneeIds(theirs).map(String)
    base = splitBase(l.syncBase?.assignees, ',')
  } else {
    // Board order, ClickUp's tag colors
    const color = new Map([...(l.tags ?? []), ...(theirs.tags ?? [])].filter(t => t.tag_bg).map(t => [t.name, t.tag_bg]))
    for (const t of [...(l.tags ?? []), ...(theirs.tags ?? [])]) {
      if (!all.has(t.name)) all.set(t.name, { key: t.name, label: t.name, color: color.get(t.name) })
    }
    board = tagNames(l)
    clickup = tagNames(theirs)
    base = splitBase(l.syncBase?.tags, '\n')
  }
  return { all: [...all.values()], board, clickup, merged: mergeKeys(board, clickup, base) }
}

export function findConflicts(
  direction: SyncDirection,
  localTasks: GanttTask[],
  remote: RemoteTask[],
  lastSyncMs: number,
): SyncConflict[] {
  const pull = direction === 'pull'
  const out: SyncConflict[] = []
  const remoteById = new Map(remote.map(r => [r.id, r]))
  const { cuidOf, localOf } = linkMaps(localTasks, remoteById)
  const tree = buildTree(localTasks)
  const nameOf = new Map(localTasks.map(t => [t.id, t.name]))
  const remoteName = (cuid: string | null) =>
    !cuid ? 'Top level' : localOf.has(cuid) ? nameOf.get(localOf.get(cuid)!) ?? '' : 'Top level'

  for (const l of localTasks) {
    const r = l.clickupId ? remoteById.get(l.clickupId) : undefined
    if (!r) continue
    const base = l.syncBase ?? {}
    const at = { taskId: l.id, task: l.name, clickupId: r.id }
    // Without a fingerprint: pull guards board edits ClickUp has not touched
    // since the last sync (nothing before the first one), push guards ClickUp
    // changes since then
    const fallback = pull ? lastSyncMs > 0 && !remoteChangedSince(r, lastSyncMs) : remoteChangedSince(r, lastSyncMs)
    const theirs = pull ? pullTarget(l, r) : mapRemoteTask(r, l.id)
    // Two milestones carry one date, the due date
    const bothMs = l.type === 'milestone' && theirs.type === 'milestone'

    for (const d of pull ? pullDiff(l, r) : pushDiff(l, r)) {
      if (d.key === 'estimate' || (pull && boardLacks(d.key, l)) || (d.key === 'start' && bothMs)) continue
      const b = base[d.key]
      let flag = fallback
      let both = false
      if (b !== undefined) {
        const boardChanged = fieldPrint(d.key, l) !== b
        const clickupChanged = fieldPrint(d.key, theirs) !== b
        flag = pull ? boardChanged : clickupChanged
        both = boardChanged && clickupChanged
      }
      if (!flag) continue
      out.push({
        id: `${l.id}|${d.key}`, ...at, key: d.key, label: d.label, board: d.local, clickup: d.remote, both,
        ...(d.key === 'assignees' || d.key === 'tags' ? { items: setItems(d.key, l, theirs) } : {}),
        ...(d.key === 'name' ? { text: { board: l.name, clickup: theirs.name } } : {}),
        ...(d.key === 'description' ? { text: { board: l.description ?? '', clickup: theirs.description ?? '' } } : {}),
      })
    }

    // Parent, against remoteParent (the ClickUp parent at the last sync). A
    // parent outside this list puts the task at the top level of the board.
    if (l.remoteParent !== undefined) {
      const remoteP = r.parent ?? null
      const parent = tree.parent.get(l.id)
      const inList = (cuid: string | null) => (cuid !== null && localOf.has(cuid) ? cuid : null)
      // A parent that only exists on the board is a board move too
      const boardP = parent ? cuidOf.get(parent) ?? `local:${parent}` : null
      const boardMoved = boardP !== inList(l.remoteParent)
      const clickupMoved = remoteP !== l.remoteParent
      const flag = pull
        ? boardMoved && boardP !== inList(remoteP)
        // Push only moves under a parent ClickUp knows, never to the top level
        : clickupMoved && !!parent && cuidOf.has(parent) && cuidOf.get(parent) !== remoteP
      if (flag) {
        out.push({
          id: `${l.id}|parent`, ...at, key: 'parent', label: 'Parent',
          board: parent ? nameOf.get(parent) ?? '' : 'Top level',
          clickup: remoteName(remoteP),
          both: boardMoved && clickupMoved,
        })
      }
    }

    // Dependency edges between tasks linked on both sides
    const boardEdges = new Set((l.dependencies ?? []).map(id => cuidOf.get(id)).filter((x): x is string => !!x))
    const clickupEdges = new Set(remotePreds(r).filter(c => localOf.has(c)))
    const baseEdges = splitBase(base.deps, ',')
    for (const c of new Set([...boardEdges, ...clickupEdges])) {
      const onBoard = boardEdges.has(c)
      if (onBoard === clickupEdges.has(c)) continue
      const flag = baseEdges
        ? pull ? onBoard !== baseEdges.has(c) : onBoard === baseEdges.has(c)
        : fallback && (pull ? onBoard : !onBoard)
      if (!flag) continue
      const pred = localOf.get(c)!
      out.push({
        id: `${l.id}|dep|${pred}`, ...at, key: 'dep', label: `Waits on "${nameOf.get(pred)}"`,
        board: onBoard ? 'Yes' : 'No', clickup: onBoard ? 'No' : 'Yes', both: false, predId: pred,
      })
    }
  }
  return out
}

function mergedValue(key: FieldKey, l: GanttTask, theirs: GanttTask, keys: string[]): Partial<GanttTask> {
  if (key === 'assignees') {
    const pool = new Map([...(theirs.assignees ?? []), ...(l.assignees ?? [])].map(a => [String(a.id), a]))
    // Display-only names without a ClickUp id stay as they were
    const unlinked = (l.assignees ?? []).filter(a => a.id === -1)
    return { assignees: [...unlinked, ...keys.map(k => pool.get(k)!).filter(Boolean)] }
  }
  const pool = new Map([...(l.tags ?? []), ...(theirs.tags ?? [])].map(t => [t.name, t]))
  return { tags: keys.map(k => pool.get(k)!).filter(Boolean) }
}

// Turns the dialog's picks into overrides for pullFromClickUp / pushToClickUp
// and one 'resolved' log entry per task. A pick of the side the operation
// takes anyway needs no override.
export function resolveConflicts(
  direction: SyncDirection,
  conflicts: SyncConflict[],
  picks: Map<string, Resolution>,
  localTasks: GanttTask[],
  remote: RemoteTask[],
): { overrides: Overrides; log: SyncLogEntry[] } {
  const overrides: Overrides = new Map()
  const resolved = new Map<string, SyncResolvedField[]>()
  const localById = new Map(localTasks.map(t => [t.id, t]))
  const remoteById = new Map(remote.map(r => [r.id, r]))
  const { localOf } = linkMaps(localTasks, remoteById)
  const take = (id: string): TaskOverride => {
    let o = overrides.get(id)
    if (!o) overrides.set(id, (o = {}))
    return o
  }
  let keptOnBoard = false

  for (const c of conflicts) {
    const l = localById.get(c.taskId)
    const r = remoteById.get(c.clickupId)
    if (!l || !r) continue
    const pick: Resolution = picks.get(c.id) ?? { use: winner(direction) }
    const how: ResolutionUse = pick.use
    const override = pick.use !== winner(direction)
    let result: string

    if (c.key === 'dep') {
      const keep = (pick.use === 'clickup' ? c.clickup : c.board) === 'Yes'
      if (override) take(l.id).deps = { ...take(l.id).deps, [c.predId!]: keep }
      result = keep ? 'Yes' : 'No'
    } else if (c.key === 'parent') {
      const remoteP = r.parent ?? null
      if (override) {
        take(l.id).parentId = pick.use === 'clickup' ? (remoteP ? localOf.get(remoteP) ?? null : null) : l.parentId ?? null
      }
      result = pick.use === 'clickup' ? c.clickup : c.board
    } else {
      const key = c.key
      const theirs = direction === 'pull' ? pullTarget(l, r) : mapRemoteTask(r, l.id)
      const fields =
        pick.use === 'board' ? copyFields(l, [key])
        : pick.use === 'clickup' ? copyFields(theirs, [key])
        : pick.use === 'merge' ? mergedValue(key, l, theirs, pick.keys)
        : key === 'name' ? { name: pick.text.trim() || l.name }
        : { description: pick.text }
      if (override) take(l.id).fields = { ...take(l.id).fields, ...fields }
      result = showField(key, { ...l, ...fields })
    }
    if (direction === 'pull' && result !== c.clickup) keptOnBoard = true
    const list = resolved.get(l.id) ?? []
    list.push({ field: c.label, board: c.board, clickup: c.clickup, result, how })
    resolved.set(l.id, list)
  }

  const log: SyncLogEntry[] = [...resolved].map(([id, list]) => {
    const l = localById.get(id)!
    return { kind: 'resolved', task: l.name, taskId: id, clickupId: l.clickupId, resolved: list }
  })
  if (keptOnBoard) {
    log.push({ kind: 'info', detail: 'Pull writes nothing to ClickUp: values kept, merged or edited on the board go with the next Push' })
  }
  return { overrides, log }
}
