// Parent / subtask hierarchy over the flat task array.
//
// The array stays flat: `parentId` links a task to its parent and the array
// order is the sibling order. The display order (every parent followed by its
// subtree) is derived here, so no operation has to keep a subtree contiguous.
// A parentId that names no task in the list, or that leads into a cycle, makes
// the task a root.

import type { GanttTask } from '../types'
import { startOfDay } from './dates'
import { isDone } from './portfolio'

export interface Tree<T extends GanttTask = GanttTask> {
  roots: T[]
  children: Map<string, T[]> // direct subtasks in array order
  parent: Map<string, string> // effective parent, valid links only
  byId: Map<string, T>
}

export function buildTree<T extends GanttTask>(tasks: T[]): Tree<T> {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const parent = new Map<string, string>()
  for (const t of tasks) {
    const p = t.parentId
    if (!p || p === t.id || !byId.has(p)) continue
    // On a cycle when walking up the raw links comes back to t
    let cur: string | undefined = p
    let onCycle = false
    for (let steps = 0; cur && steps <= tasks.length; steps++) {
      if (cur === t.id) { onCycle = true; break }
      const up: string | undefined = byId.get(cur)?.parentId
      cur = up && byId.has(up) ? up : undefined
    }
    if (!onCycle) parent.set(t.id, p)
  }
  const roots: T[] = []
  const children = new Map<string, T[]>()
  for (const t of tasks) {
    const p = parent.get(t.id)
    if (p === undefined) { roots.push(t); continue }
    const list = children.get(p)
    if (list) list.push(t)
    else children.set(p, [t])
  }
  return { roots, children, parent, byId }
}

// Every task below `id`, in display order
export function descendants<T extends GanttTask>(id: string, tree: Tree<T>): T[] {
  const out: T[] = []
  const walk = (pid: string) => {
    for (const c of tree.children.get(pid) ?? []) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

// Parent first, root last
export function ancestors(id: string, tree: Tree): string[] {
  const out: string[] = []
  for (let p = tree.parent.get(id); p !== undefined; p = tree.parent.get(p)) out.push(p)
  return out
}

export function isAncestor(ancestorId: string, id: string, tree: Tree): boolean {
  return ancestors(id, tree).includes(ancestorId)
}

/* --------------------------------------------------------------- display */

export interface TreeRow<T extends GanttTask = GanttTask> {
  task: T
  depth: number
  childCount: number // direct subtasks, whether shown or not
  doneChildren: number
  collapsed: boolean // has subtasks and they are hidden
  context: boolean // shown only as the ancestor of a filter match
}

export interface FlattenOptions {
  collapsed?: ReadonlySet<string>
  // Filter matches. Their ancestors are added as context rows, which are
  // always expanded so the match stays reachable. Absent = every task.
  include?: ReadonlySet<string>
}

export function flattenTree<T extends GanttTask>(tasks: T[], opts: FlattenOptions = {}): TreeRow<T>[] {
  const tree = buildTree(tasks)
  const { collapsed, include } = opts
  let shown: Set<string> | null = null
  if (include) {
    shown = new Set<string>()
    for (const id of include) {
      if (!tree.byId.has(id)) continue
      shown.add(id)
      for (const a of ancestors(id, tree)) shown.add(a)
    }
  }
  const out: TreeRow<T>[] = []
  const walk = (t: T, depth: number) => {
    if (shown && !shown.has(t.id)) return
    const kids = tree.children.get(t.id) ?? []
    const context = !!include && !include.has(t.id)
    const isCollapsed = kids.length > 0 && !context && !!collapsed?.has(t.id)
    out.push({
      task: t,
      depth,
      childCount: kids.length,
      doneChildren: kids.filter(isDone).length,
      collapsed: isCollapsed,
      context,
    })
    if (!isCollapsed) for (const c of kids) walk(c, depth + 1)
  }
  for (const r of tree.roots) walk(r, 0)
  return out
}

// Depth of each selected task counting only selected ancestors, so a
// selection of subtasks without their parent is not indented
export function selectionDepths(selection: GanttTask[], tree: Tree): Map<string, number> {
  const ids = new Set(selection.map(t => t.id))
  return new Map(selection.map(t => [t.id, ancestors(t.id, tree).filter(a => ids.has(a)).length]))
}

// Earliest start to latest due date over the dated subtasks, or null
export function subtreeSpan(id: string, tree: Tree): { start: Date; end: Date } | null {
  let start: Date | undefined
  let end: Date | undefined
  for (const t of descendants(id, tree)) {
    const s = t.start ?? t.end
    const e = t.end ?? t.start
    if (s && (!start || s < start)) start = s
    if (e && (!end || e > end)) end = e
  }
  return start && end ? { start, end } : null
}

// Tasks that move along when `id` is dragged: its dependency successors and
// its subtasks, transitively (a subtask's successors move too).
export function dragClosure(id: string, tasks: GanttTask[]): string[] {
  const tree = buildTree(tasks)
  const successors = new Map<string, string[]>()
  for (const t of tasks) {
    for (const d of t.dependencies ?? []) {
      const list = successors.get(d)
      if (list) list.push(t.id)
      else successors.set(d, [t.id])
    }
  }
  const seen = new Set([id])
  const out: string[] = []
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    const next = [...(successors.get(cur) ?? []), ...(tree.children.get(cur) ?? []).map(c => c.id)]
    for (const n of next) {
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
      queue.push(n)
    }
  }
  return out
}

/* ------------------------------------------------------------ operations */

// ClickUp's API cannot turn a subtask back into a top-level task, so a task
// that is a subtask in ClickUp has to keep some parent.
export function canBecomeTopLevel(t: GanttTask): boolean {
  return !(t.clickupId && t.remoteParent)
}

export const TOP_LEVEL_BLOCKED =
  'This is a subtask in ClickUp, and ClickUp\'s API cannot make it a top-level task. ' +
  'Use "Convert to > Parent task" in ClickUp, then Pull.'

export type DropPosition = 'before' | 'after' | 'inside' | 'inside-first'

// Where `id` would end up, or null when the move is not allowed: into its own
// subtree, onto itself, or to the top level when the task must keep a parent.
export function moveTarget(
  tree: Tree, id: string, targetId: string, pos: DropPosition,
): { parentId: string | undefined } | null {
  const moved = tree.byId.get(id)
  if (!moved || !tree.byId.has(targetId) || id === targetId) return null
  if (isAncestor(id, targetId, tree)) return null
  const parentId = pos === 'before' || pos === 'after' ? tree.parent.get(targetId) : targetId
  if (parentId === undefined && tree.parent.has(id) && !canBecomeTopLevel(moved)) return null
  return { parentId }
}

export function moveTask<T extends GanttTask>(tasks: T[], id: string, targetId: string, pos: DropPosition): T[] {
  const tree = buildTree(tasks)
  const target = moveTarget(tree, id, targetId, pos)
  if (!target) return tasks
  const moved = tree.byId.get(id)!
  const rest = tasks.filter(t => t.id !== id)
  let at: number
  if (pos === 'before') at = rest.findIndex(t => t.id === targetId)
  else if (pos === 'after') at = rest.findIndex(t => t.id === targetId) + 1
  else if (pos === 'inside') at = rest.length
  else {
    const first = (tree.children.get(targetId) ?? []).find(c => c.id !== id)
    at = first ? rest.indexOf(first) : rest.findIndex(t => t.id === targetId) + 1
  }
  const next = [...rest]
  next.splice(at, 0, { ...moved, parentId: target.parentId })
  return next
}

// Makes `id` the last subtask of `parentId`, or (undefined) a top-level task
// placed right after the tree it came from.
export function setParent<T extends GanttTask>(tasks: T[], id: string, parentId: string | undefined): T[] {
  const tree = buildTree(tasks)
  if (!tree.byId.has(id) || tree.parent.get(id) === parentId) return tasks
  if (parentId !== undefined) return moveTask(tasks, id, parentId, 'inside')
  const chain = ancestors(id, tree)
  return moveTask(tasks, id, chain[chain.length - 1], 'after')
}

// The previous sibling becomes the parent (as its last subtask)
export function indentTarget(tree: Tree, id: string): string | null {
  const p = tree.parent.get(id)
  const siblings = p === undefined ? tree.roots : tree.children.get(p) ?? []
  const i = siblings.findIndex(t => t.id === id)
  return i > 0 ? siblings[i - 1].id : null
}

export function indentTask<T extends GanttTask>(tasks: T[], id: string): T[] {
  const target = indentTarget(buildTree(tasks), id)
  return target ? moveTask(tasks, id, target, 'inside') : tasks
}

// One level up: becomes the sibling right after its old parent
export function canOutdent(tree: Tree, id: string): boolean {
  const p = tree.parent.get(id)
  return p !== undefined && moveTarget(tree, id, p, 'after') !== null
}

export function outdentTask<T extends GanttTask>(tasks: T[], id: string): T[] {
  const p = buildTree(tasks).parent.get(id)
  return p === undefined ? tasks : moveTask(tasks, id, p, 'after')
}

export type DateSortKey = 'start' | 'due'
export type SortDir = 'asc' | 'desc'

// Local day of a task's start or due date (a one-date task or milestone uses
// that date for both), or null when it has no dates
function sortDay(t: GanttTask, key: DateSortKey): number | null {
  const d = key === 'start' ? t.start ?? t.end : t.end ?? t.start
  return d ? startOfDay(d).getTime() : null
}

// Reorders by a date. Array order is sibling order, so every level ends up
// sorted and each subtask stays under its parent. Compared by local day, so
// times of day (frappe's 23:59:59 ends, ClickUp's 4 am) never decide; a tie
// goes to the other date, then keeps the current order. Undated tasks last in
// both directions. Returns `tasks` itself when nothing moves.
export function sortByDate<T extends GanttTask>(tasks: T[], key: DateSortKey, dir: SortDir = 'asc'): T[] {
  const other: DateSortKey = key === 'start' ? 'due' : 'start'
  const sign = dir === 'asc' ? 1 : -1
  const sorted = [...tasks].sort((a, b) => {
    const ka = sortDay(a, key)
    const kb = sortDay(b, key)
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1
    if (ka !== kb) return sign * (ka - kb)
    return sign * (sortDay(a, other)! - sortDay(b, other)!)
  })
  return sorted.every((t, i) => t === tasks[i]) ? tasks : sorted
}

export function removeSubtree<T extends GanttTask>(tasks: T[], id: string): T[] {
  const tree = buildTree(tasks)
  const gone = new Set([id, ...descendants(id, tree).map(t => t.id)])
  return tasks.filter(t => !gone.has(t.id))
}
