// Tasks deleted on the board that still exist in ClickUp.
//
// A board delete of a subtree holding a linked task is recorded as a pending
// deletion (a snapshot of the removed rows). Push asks, per pending deletion,
// whether to delete it in ClickUp too; Pull keeps it off the board meanwhile;
// Restore puts the snapshot back. A pending deletion whose linked tasks are no
// longer in the list (deleted there, moved, another list linked) is dropped.

import type { GanttTask, PendingDeletion } from '../types'
import type { RemoteTask } from './clickup'
import { linkMaps } from './sync'
import { buildTree, descendants } from './tree'

export const linkedCuids = (d: PendingDeletion): string[] =>
  d.tasks.map(t => t.clickupId).filter((c): c is string => !!c)

export const pendingCuids = (pending: PendingDeletion[]): Set<string> =>
  new Set(pending.flatMap(linkedCuids))

// Records the removal of `id` and its subtasks. Deleting rows that were never
// in ClickUp records nothing.
export function recordDeletion(pending: PendingDeletion[], tasks: GanttTask[], id: string, now: Date): PendingDeletion[] {
  const tree = buildTree(tasks)
  const root = tree.byId.get(id)
  if (!root) return pending
  const below = new Set(descendants(id, tree).map(t => t.id))
  const rows = [root, ...tasks.filter(t => below.has(t.id))]
  if (!rows.some(t => t.clickupId)) return pending
  return [
    ...pending.filter(d => d.id !== id),
    { id, deletedAt: now.toISOString(), index: tasks.indexOf(root), tasks: rows },
  ]
}

// Puts the removed rows back where the root was. Rows already on the board
// again (same id or ClickUp task) are not duplicated.
export function restoreDeletion(tasks: GanttTask[], d: PendingDeletion): GanttTask[] {
  const ids = new Set(tasks.map(t => t.id))
  const cuids = new Set(tasks.map(t => t.clickupId).filter(Boolean))
  const back = d.tasks.filter(t => !ids.has(t.id) && !(t.clickupId && cuids.has(t.clickupId)))
  if (!back.length) return tasks
  const at = Math.min(Math.max(d.index, 0), tasks.length)
  return [...tasks.slice(0, at), ...back, ...tasks.slice(at)]
}

// Drops pending deletions with nothing left in the fetched list
export function prunePending(pending: PendingDeletion[], remote: RemoteTask[]): PendingDeletion[] {
  const ids = new Set(remote.map(r => r.id))
  const out = pending.filter(d => linkedCuids(d).some(c => ids.has(c)))
  return out.length === pending.length ? pending : out
}

export interface DeletionTarget {
  cuid: string
  name: string
}

export interface DeletionExtra extends DeletionTarget {
  onBoard: boolean
}

// One question of the push: delete this pending deletion in ClickUp?
export interface DeletionCandidate {
  id: string // pending deletion id
  name: string // root name on the board
  deletedAt: string
  // Its linked tasks still in the list, in board order
  tasks: DeletionTarget[]
  // The topmost of those; ClickUp deletes subtasks with their parent
  deleteCuids: string[]
  // Everything those deletes remove in ClickUp
  doomed: string[]
  // Doomed tasks that are not pending deletion: still on the board, or added
  // in ClickUp since
  extra: DeletionExtra[]
  // Some of its tasks were updated in ClickUp after the board delete
  changedInClickUp: boolean
}

// The questions a push asks, oldest deletion first. The ClickUp hierarchy is
// taken as it will be once the push has moved board rows: a board row under a
// linked or new board parent is moved out before anything is deleted, any
// other task keeps its ClickUp parent (a board top-level row too, since
// ClickUp cannot un-nest a subtask).
export function planDeletions(pending: PendingDeletion[], board: GanttTask[], remote: RemoteTask[]): DeletionCandidate[] {
  const remoteById = new Map(remote.map(r => [r.id, r]))
  const tree = buildTree(board)
  const { cuidOf, localOf } = linkMaps(board, remoteById)

  const plannedParent = (r: RemoteTask): string | null => {
    const local = localOf.get(r.id)
    const p = local ? tree.parent.get(local) : undefined
    if (p !== undefined) return cuidOf.get(p) ?? null
    return r.parent ?? null
  }
  const parentOf = new Map(remote.map(r => [r.id, plannedParent(r)]))
  const children = new Map<string, string[]>()
  for (const [id, p] of parentOf) {
    if (!p) continue
    const list = children.get(p)
    if (list) list.push(id)
    else children.set(p, [id])
  }
  const subtree = (cuid: string, out: Set<string>) => {
    if (out.has(cuid)) return
    out.add(cuid)
    for (const c of children.get(cuid) ?? []) subtree(c, out)
  }
  const hasAncestorIn = (cuid: string, set: Set<string>): boolean => {
    const seen = new Set([cuid])
    for (let p = parentOf.get(cuid); p; p = parentOf.get(p)) {
      if (seen.has(p)) return false
      if (set.has(p)) return true
      seen.add(p)
    }
    return false
  }

  // A pending ClickUp task back on the board (pulled again) is not deleted
  const offBoard = (c: string) => remoteById.has(c) && !localOf.has(c)
  const allPending = new Set([...pendingCuids(pending)].filter(offBoard))

  const out: DeletionCandidate[] = []
  const byAge = [...pending].sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt))
  for (const d of byAge) {
    const tasks = d.tasks
      .filter(t => t.clickupId && offBoard(t.clickupId))
      .map(t => ({ cuid: t.clickupId!, name: t.name }))
    if (!tasks.length) continue
    const own = new Set(tasks.map(t => t.cuid))
    const deleteCuids = [...own].filter(c => !hasAncestorIn(c, own))
    const doomedSet = new Set<string>()
    for (const c of deleteCuids) subtree(c, doomedSet)
    const doomed = [...doomedSet]
    const since = Date.parse(d.deletedAt)
    out.push({
      id: d.id,
      name: d.tasks[0]?.name ?? '',
      deletedAt: d.deletedAt,
      tasks,
      deleteCuids,
      doomed,
      extra: doomed
        .filter(c => !allPending.has(c))
        .map(c => ({ cuid: c, name: remoteById.get(c)!.name, onBoard: localOf.has(c) })),
      changedInClickUp: tasks.some(t => Number(remoteById.get(t.cuid)!.date_updated || 0) > since),
    })
  }
  return out
}
