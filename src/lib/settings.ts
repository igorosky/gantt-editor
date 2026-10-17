// User settings: which task warnings apply, the week layout, which statuses
// count as backlog and where backlog tasks are left out, and the portfolio
// thresholds. Pure; the defaults reproduce the behaviour from before settings
// existed. Persisted by hooks/useSettings.

import type { GanttTask } from '../types'
import { DEFAULT_CALENDAR, type Calendar } from './dates'

// Places where backlog tasks can be left out
export type BacklogArea = 'board' | 'warnings' | 'health' | 'workload'

export const BACKLOG_AREAS: BacklogArea[] = ['board', 'warnings', 'health', 'workload']

export interface Settings {
  warnings: {
    emptyDescription: boolean
    missingDod: boolean
    missingPriority: boolean
    // Phrases the description must contain to count as having a DoD
    dodKeywords: string[]
  }
  calendar: Calendar
  backlog: {
    // Status names that mark a backlog task, compared case-insensitively
    statuses: string[]
    // true = backlog tasks are included there
    include: Record<BacklogArea, boolean>
  }
  rules: {
    // "Due soon" window used by the risk list
    dueSoonDays: number
    // Red when this share of open tasks is overdue
    redOverdueShare: number
    // Amber when this share of open tasks has no start or no end date
    amberUnscheduledShare: number
  }
}

export const DEFAULT_DOD_KEYWORDS = ['DoD', 'Definition of Done']

export const DEFAULT_SETTINGS: Settings = {
  warnings: {
    emptyDescription: true,
    missingDod: true,
    missingPriority: false,
    dodKeywords: DEFAULT_DOD_KEYWORDS,
  },
  calendar: DEFAULT_CALENDAR,
  backlog: {
    statuses: ['backlog'],
    include: { board: true, warnings: true, health: true, workload: true },
  },
  rules: {
    dueSoonDays: 7,
    redOverdueShare: 0.2,
    amberUnscheduledShare: 0.25,
  },
}

/* ------------------------------------------------------------- normalize */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

// Trimmed, non-empty, unique (case-insensitive), first spelling kept
export function cleanNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const name = x.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

function weekdays(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const days = v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
  return [...new Set(days)].sort((a, b) => a - b)
}

// Reads a stored (possibly old, partial or hand-edited) value field by field;
// anything missing or invalid takes its default.
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  const r = isObj(raw) ? raw : {}
  const w = isObj(r.warnings) ? r.warnings : {}
  const c = isObj(r.calendar) ? r.calendar : {}
  const b = isObj(r.backlog) ? r.backlog : {}
  const inc = isObj(b.include) ? b.include : {}
  const ru = isObj(r.rules) ? r.rules : {}

  const keywords = cleanNames(w.dodKeywords)
  const workdays = weekdays(c.workdays)
  const weekStart = Number.isInteger(c.weekStart) && (c.weekStart as number) >= 0 && (c.weekStart as number) <= 6
    ? c.weekStart as number
    : d.calendar.weekStart

  return {
    warnings: {
      emptyDescription: bool(w.emptyDescription, d.warnings.emptyDescription),
      missingDod: bool(w.missingDod, d.warnings.missingDod),
      missingPriority: bool(w.missingPriority, d.warnings.missingPriority),
      dodKeywords: keywords.length ? keywords : d.warnings.dodKeywords,
    },
    calendar: {
      weekStart,
      workdays: workdays.length ? workdays : d.calendar.workdays,
    },
    backlog: {
      // An empty list is a valid choice: nothing is backlog
      statuses: Array.isArray(b.statuses) ? cleanNames(b.statuses) : d.backlog.statuses,
      include: {
        board: bool(inc.board, true),
        warnings: bool(inc.warnings, true),
        health: bool(inc.health, true),
        workload: bool(inc.workload, true),
      },
    },
    rules: {
      dueSoonDays: Math.round(num(ru.dueSoonDays, 0, 365, d.rules.dueSoonDays)),
      redOverdueShare: num(ru.redOverdueShare, 0, 1, d.rules.redOverdueShare),
      amberUnscheduledShare: num(ru.amberUnscheduledShare, 0, 1, d.rules.amberUnscheduledShare),
    },
  }
}

/* --------------------------------------------------------------- backlog */

export function isBacklog(t: GanttTask, s: Settings): boolean {
  if (!t.status) return false
  const status = t.status.trim().toLowerCase()
  return s.backlog.statuses.some(name => name.toLowerCase() === status)
}

// The tasks to use in `area`: all of them when backlog is included there
export function withoutBacklog<T extends GanttTask>(tasks: T[], s: Settings, area: BacklogArea): T[] {
  if (s.backlog.include[area] || s.backlog.statuses.length === 0) return tasks
  return tasks.filter(t => !isBacklog(t, s))
}

/* ------------------------------------------------------------------- DoD */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Last built pattern: every task row asks with the same keywords
let dodCache: { key: string; re: RegExp } | null = null

// Whole-phrase match, case-insensitive. Boundaries are Unicode-aware (\b is
// ASCII-only), so phrases with Polish letters at their ends still match.
export function dodPattern(keywords: string[]): RegExp {
  const words = cleanNames(keywords)
  const key = (words.length ? words : DEFAULT_DOD_KEYWORDS).join('\n')
  if (dodCache?.key === key) return dodCache.re
  const alts = key.split('\n')
    .map(w => escapeRe(w).replace(/\s+/g, '\\s+'))
    .join('|')
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts})(?![\\p{L}\\p{N}_])`, 'iu')
  dodCache = { key, re }
  return re
}

/* -------------------------------------------------------------- weekdays */

// Date.getDay() order
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Weekday numbers in week order, starting from weekStart
export function weekOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
}

// "Mon-Fri" for a consecutive run (wrapping over the weekend, e.g. "Sun-Thu"
// or "Sat-Wed"), otherwise a list: "Mon, Wed, Fri".
export function workdayLabel(workdays: number[]): string {
  const days = [...new Set(workdays)].filter(d => d >= 0 && d <= 6)
  if (days.length === 0) return 'no working days'
  if (days.length === 7) return 'every day'
  if (days.length === 1) return WEEKDAYS[days[0]]
  const set = new Set(days)
  // A run starts at the day whose predecessor is not a workday
  const starts = days.filter(d => !set.has((d + 6) % 7))
  if (starts.length === 1) {
    const first = starts[0]
    const last = (first + days.length - 1) % 7
    return `${WEEKDAYS[first]}-${WEEKDAYS[last]}`
  }
  return weekOrder(1).filter(d => set.has(d)).map(d => WEEKDAYS[d]).join(', ')
}
