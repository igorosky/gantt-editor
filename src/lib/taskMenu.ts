// The task context menu, shared by a row's right-click, its ⋯ button and a
// bar's right-click. Pure: it returns descriptors with action ids, and the
// board maps the ids to handlers. One task gets the full menu; a selection of
// several gets the bulk actions.

import type { GanttTask } from '../types'
import type { ClickUpStatus } from './clickup'
import {
  ancestors, canBecomeTopLevel, canOutdent, indentTarget, moveTarget, TOP_LEVEL_BLOCKED, type Tree,
} from './tree'
import { depIndex, violatedPredecessors } from './depGraph'

export type MenuAction =
  | 'open' | 'rename' | 'add-pred' | 'add-succ'
  | 'path-both' | 'path-up' | 'path-down' | 'select-path' | 'snap'
  | 'add-subtask' | 'indent' | 'outdent' | 'top-level' | 'delete'
  | 'assign' | 'shift' | 'chain' | 'unlink' | 'clear-selection'
  | `status:${string}` | `priority:${1 | 2 | 3 | 4}` | 'priority:none'

export interface MenuItem {
  id: string // a MenuAction, or a submenu / separator id
  label: string
  hint?: string // keyboard shortcut shown on the right
  disabledReason?: string // set = shown greyed out, with this as its title
  danger?: boolean
  color?: string // a dot before the label (statuses, priorities)
  checked?: boolean
  children?: MenuItem[]
  separator?: boolean
}

export interface MenuContext {
  ids: string[] // the tasks acted on, in display order
  tasks: GanttTask[] // every task on the board
  tree: Tree
  statuses?: readonly ClickUpStatus[] // the list's statuses (linked board)
  canAssign: boolean // ClickUp connected: people to assign
  dependencyWarnings: boolean
}

export const PRIORITY_LABELS: Record<1 | 2 | 3 | 4, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#ef4444' },
  2: { label: 'High', color: '#f59e0b' },
  3: { label: 'Normal', color: '#64748b' },
  4: { label: 'Low', color: '#94a3b8' },
}

const sep = (id: string): MenuItem => ({ id, label: '', separator: true })

function pathMenu(hasUp: boolean, hasDown: boolean, label: string): MenuItem {
  const none = 'No dependencies'
  return {
    id: 'path',
    label,
    disabledReason: hasUp || hasDown ? undefined : none,
    children: [
      { id: 'path-both', label: 'Upstream and downstream', hint: 'P' },
      { id: 'path-up', label: 'Upstream only', disabledReason: hasUp ? undefined : 'No predecessors' },
      { id: 'path-down', label: 'Downstream only', disabledReason: hasDown ? undefined : 'No successors' },
      sep('path-sep'),
      { id: 'select-path', label: 'Select the whole path' },
    ],
  }
}

function statusMenu(ctx: MenuContext, current: Set<string>): MenuItem | null {
  if (!ctx.statuses?.length) return null
  return {
    id: 'status',
    label: 'Set status',
    children: [...ctx.statuses]
      .sort((a, b) => Number(a.orderindex) - Number(b.orderindex))
      .map(s => ({
        id: `status:${s.status}`, label: s.status, color: s.color,
        checked: current.size === 1 && current.has(s.status.toLowerCase()),
      })),
  }
}

function priorityMenu(current: Set<number | undefined>): MenuItem {
  const one = current.size === 1 ? [...current][0] : null
  return {
    id: 'priority',
    label: 'Set priority',
    children: [
      ...([1, 2, 3, 4] as const).map(n => ({
        id: `priority:${n}`, label: PRIORITY_LABELS[n].label, color: PRIORITY_LABELS[n].color, checked: one === n,
      })),
      sep('priority-sep'),
      { id: 'priority:none', label: 'No priority', checked: one === undefined && current.size === 1 },
    ],
  }
}

export function buildTaskMenu(ctx: MenuContext): MenuItem[] {
  const idx = depIndex(ctx.tasks)
  const targets = ctx.ids.filter(id => idx.byId.has(id))
  if (!targets.length) return []
  const hasUp = targets.some(id => (idx.preds.get(id) ?? []).length > 0)
  const hasDown = targets.some(id => (idx.succs.get(id) ?? []).length > 0)
  const statuses = new Set(targets.map(id => (idx.byId.get(id)!.status ?? '').toLowerCase()))
  const priorities = new Set(targets.map(id => idx.byId.get(id)!.priority))

  if (targets.length === 1) {
    const id = targets[0]
    const t = idx.byId.get(id)!
    const chain = ancestors(id, ctx.tree)
    const depth = chain.length
    const root = chain[chain.length - 1]
    const blocked = depth > 0 && !canBecomeTopLevel(t) ? TOP_LEVEL_BLOCKED : undefined
    const children = ctx.tree.children.get(id)?.length ?? 0
    const late = ctx.dependencyWarnings ? violatedPredecessors(ctx.tasks, id) : []
    const status = statusMenu(ctx, statuses)
    return [
      { id: 'open', label: 'Open details', hint: 'Enter' },
      { id: 'rename', label: 'Rename', hint: 'F2' },
      sep('s1'),
      { id: 'add-pred', label: 'Add predecessor…' },
      { id: 'add-succ', label: 'Add successor…' },
      pathMenu(hasUp, hasDown, 'Highlight path'),
      ...(late.length
        ? [{ id: 'snap', label: 'Start after predecessors', hint: `${late.length} late` }]
        : []),
      sep('s2'),
      ...(status ? [status] : []),
      priorityMenu(priorities),
      ...(ctx.canAssign ? [{ id: 'assign', label: 'Assign…' }] : []),
      sep('s3'),
      { id: 'add-subtask', label: 'Add subtask' },
      {
        id: 'indent', label: 'Make subtask of task above', hint: 'Tab',
        disabledReason: indentTarget(ctx.tree, id) ? undefined : 'No task above to nest under',
      },
      {
        id: 'outdent', label: 'Move up a level', hint: 'Shift+Tab',
        disabledReason: canOutdent(ctx.tree, id) ? undefined : depth === 0 ? 'Already a top-level task' : blocked ?? 'Not possible here',
      },
      ...(depth >= 2
        ? [{
            id: 'top-level', label: 'Make top-level task',
            disabledReason: moveTarget(ctx.tree, id, root, 'after') ? undefined : blocked ?? 'Not possible here',
          }]
        : []),
      sep('s4'),
      { id: 'delete', label: children ? 'Delete with subtasks' : 'Delete', hint: 'Del', danger: true },
    ]
  }

  const set = new Set(targets)
  const linkedWithin = targets.some(id => (idx.preds.get(id) ?? []).some(p => set.has(p)))
  const status = statusMenu(ctx, statuses)
  const withSubtasks = targets.some(id => (ctx.tree.children.get(id)?.length ?? 0) > 0)
  return [
    pathMenu(hasUp, hasDown, 'Highlight paths'),
    sep('m1'),
    ...(status ? [status] : []),
    priorityMenu(priorities),
    ...(ctx.canAssign ? [{ id: 'assign', label: 'Assign…' }] : []),
    { id: 'shift', label: 'Shift dates…' },
    sep('m2'),
    { id: 'chain', label: 'Link as chain', hint: 'in row order' },
    { id: 'unlink', label: 'Unlink selected', disabledReason: linkedWithin ? undefined : 'No links between the selected tasks' },
    sep('m3'),
    { id: 'clear-selection', label: 'Clear selection', hint: 'Esc' },
    {
      id: 'delete',
      label: `Delete ${targets.length} tasks${withSubtasks ? ' with subtasks' : ''}`,
      hint: 'Del',
      danger: true,
    },
  ]
}

// The action ids a menu offers, enabled ones only (submenus included)
export function enabledActions(items: readonly MenuItem[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.separator || it.disabledReason) continue
    if (it.children) out.push(...enabledActions(it.children))
    else out.push(it.id)
  }
  return out
}
