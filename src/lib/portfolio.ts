// Task state and project health rules for the portfolio views. Pure: every
// date-dependent function takes `today` so results are reproducible in tests.

import type { GanttTask } from '../types'
import { addDays, daysBetween, startOfDay } from './dates'

// Same rule as utils.isMilestone, repeated here so utils can import this module
// (overdue filter) without an import cycle.
const isMilestone = (t: GanttTask): boolean => t.type === 'milestone'

// A task as the health rules see it. `warningIds` is precomputed for cached
// portfolio tasks (their description is dropped); absent means no warnings.
export type HealthTask = GanttTask & { warningIds?: string[] }

/* ------------------------------------------------------------- RAG rules */

// Red when this share of open tasks is overdue
export const RED_OVERDUE_SHARE = 0.2
// Amber when this share of open tasks has no start or no end date
export const AMBER_UNSCHEDULED_SHARE = 0.25
// "Due soon" window used by the risk list
export const DUE_SOON_DAYS = 7

/* ------------------------------------------------------------ task state */

const DONE_TYPES = new Set(['closed', 'done'])
const DONE_NAME_RE = /^(done|complete|completed|closed|finished|resolved)$/i
const NOT_STARTED_NAME_RE = /^(to ?do|open|not started|backlog|new)$/i

// ClickUp's status type is authoritative; the status name is only a fallback
// for rows that never went through a sync carrying the type.
export function isDone(t: GanttTask): boolean {
  if (t.statusType) return DONE_TYPES.has(t.statusType)
  return !!t.status && DONE_NAME_RE.test(t.status.trim())
}

function isNotStarted(t: GanttTask): boolean {
  if (t.statusType) return t.statusType === 'open'
  return !t.status || NOT_STARTED_NAME_RE.test(t.status.trim())
}

export function isOverdue(t: GanttTask, today: Date): boolean {
  return !isDone(t) && !!t.end && startOfDay(t.end) < startOfDay(today)
}

export function daysLate(t: GanttTask, today: Date): number {
  return isOverdue(t, today) ? daysBetween(t.end!, today) : 0
}

// Start date passed but the task still sits in its initial status
export function isLateStart(t: GanttTask, today: Date): boolean {
  if (isDone(t) || isMilestone(t) || !t.start) return false
  return startOfDay(t.start) < startOfDay(today) && isNotStarted(t)
}

export function isDueSoon(t: GanttTask, today: Date, days = DUE_SOON_DAYS): boolean {
  if (isDone(t) || !t.end) return false
  const end = startOfDay(t.end)
  return end >= startOfDay(today) && end <= addDays(today, days)
}

export function isUnscheduled(t: GanttTask): boolean {
  return isMilestone(t) ? !t.end && !t.start : !t.start || !t.end
}

export function isUnassigned(t: GanttTask): boolean {
  return !isMilestone(t) && !(t.assignees?.length)
}

export function hasQualityWarning(t: HealthTask): boolean {
  return (t.warningIds?.length ?? 0) > 0
}

/* ---------------------------------------------------------------- health */

export type Rag = 'red' | 'amber' | 'green' | 'done' | 'empty'

export const RAG_LABEL: Record<Rag, string> = {
  red: 'Off track',
  amber: 'At risk',
  green: 'On track',
  done: 'Done',
  empty: 'No tasks',
}

// Lower sorts first: worst health on top
export const RAG_ORDER: Record<Rag, number> = { red: 0, amber: 1, green: 2, done: 3, empty: 4 }

export interface ProjectHealth {
  total: number
  done: number
  open: number
  donePct: number // 0..1, by task count
  overdue: number
  overdueMilestones: number
  lateStart: number
  dueSoon: number
  unscheduled: number
  unassigned: number
  quality: number
  start?: Date
  end?: Date
  nextMilestone?: GanttTask
  rag: Rag
  ragReasons: string[]
}

export function projectSpan(tasks: GanttTask[]): { start?: Date; end?: Date } {
  let start: Date | undefined
  let end: Date | undefined
  for (const t of tasks) {
    const s = t.start ?? t.end
    const e = t.end ?? t.start
    if (s && (!start || s < start)) start = s
    if (e && (!end || e > end)) end = e
  }
  return { start, end }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function projectHealth(tasks: HealthTask[], today: Date): ProjectHealth {
  const h: ProjectHealth = {
    total: tasks.length, done: 0, open: 0, donePct: 0,
    overdue: 0, overdueMilestones: 0, lateStart: 0, dueSoon: 0,
    unscheduled: 0, unassigned: 0, quality: 0,
    ...projectSpan(tasks),
    rag: 'empty', ragReasons: [],
  }
  const t0 = startOfDay(today)
  for (const t of tasks) {
    if (isDone(t)) { h.done++; continue }
    h.open++
    if (isOverdue(t, today)) {
      h.overdue++
      if (isMilestone(t)) h.overdueMilestones++
    }
    if (isLateStart(t, today)) h.lateStart++
    if (isDueSoon(t, today)) h.dueSoon++
    if (isUnscheduled(t)) h.unscheduled++
    if (isUnassigned(t)) h.unassigned++
    if (hasQualityWarning(t)) h.quality++
    if (isMilestone(t) && t.end && startOfDay(t.end) >= t0 &&
        (!h.nextMilestone || t.end < h.nextMilestone.end!)) {
      h.nextMilestone = t
    }
  }
  h.donePct = h.total ? h.done / h.total : 0

  if (h.total === 0) return h
  if (h.open === 0) { h.rag = 'done'; return h }

  const red: string[] = []
  if (h.overdueMilestones) red.push(`${plural(h.overdueMilestones, 'milestone')} overdue`)
  if (h.end && startOfDay(h.end) < t0) red.push(`End date passed with ${plural(h.open, 'open task')}`)
  if (h.overdue / h.open >= RED_OVERDUE_SHARE) {
    red.push(`${Math.round((h.overdue / h.open) * 100)}% of open tasks overdue`)
  }
  if (red.length) { h.rag = 'red'; h.ragReasons = red; return h }

  const amber: string[] = []
  if (h.overdue) amber.push(`${plural(h.overdue, 'task')} overdue`)
  if (h.lateStart) amber.push(`${plural(h.lateStart, 'task')} not started on time`)
  if (h.unscheduled / h.open >= AMBER_UNSCHEDULED_SHARE) {
    amber.push(`${Math.round((h.unscheduled / h.open) * 100)}% of open tasks unscheduled`)
  }
  if (amber.length) { h.rag = 'amber'; h.ragReasons = amber; return h }

  h.rag = 'green'
  return h
}

/* ----------------------------------------------------------------- risks */

export type RiskKind = 'overdue' | 'late-start' | 'due-soon' | 'undated' | 'unassigned' | 'quality'

export const RISK_KINDS: RiskKind[] = ['overdue', 'late-start', 'due-soon', 'undated', 'unassigned', 'quality']

export const RISK_LABEL: Record<RiskKind, string> = {
  'overdue': 'Overdue',
  'late-start': 'Starting late',
  'due-soon': `Due in ${DUE_SOON_DAYS}d`,
  'undated': 'Undated',
  'unassigned': 'Unassigned',
  'quality': 'Missing desc / DoD',
}

export interface RiskItem<T extends HealthTask = HealthTask> {
  projectId: string
  task: T
  kinds: RiskKind[] // in RISK_KINDS order, worst first
  daysLate: number
}

export function taskRisks(t: HealthTask, today: Date): RiskKind[] {
  if (isDone(t)) return []
  const out: RiskKind[] = []
  if (isOverdue(t, today)) out.push('overdue')
  if (isLateStart(t, today)) out.push('late-start')
  if (isDueSoon(t, today)) out.push('due-soon')
  if (isUnscheduled(t)) out.push('undated')
  if (isUnassigned(t)) out.push('unassigned')
  if (hasQualityWarning(t)) out.push('quality')
  return out
}

// Open tasks with at least one risk, worst kind first, then most days late,
// then earliest due date.
export function riskItems<T extends HealthTask>(
  projects: Array<{ id: string; tasks: T[] }>,
  today: Date,
): RiskItem<T>[] {
  const out: RiskItem<T>[] = []
  for (const p of projects) {
    for (const t of p.tasks) {
      const kinds = taskRisks(t, today)
      if (kinds.length) out.push({ projectId: p.id, task: t, kinds, daysLate: daysLate(t, today) })
    }
  }
  const rank = (k: RiskKind) => RISK_KINDS.indexOf(k)
  return out.sort((a, b) =>
    rank(a.kinds[0]) - rank(b.kinds[0]) ||
    b.daysLate - a.daysLate ||
    (a.task.end?.getTime() ?? Infinity) - (b.task.end?.getTime() ?? Infinity))
}
