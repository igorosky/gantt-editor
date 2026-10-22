// Local-time calendar helpers shared by the export renderer and the portfolio
// views. Everything works on whole days at local midnight.

export type TimeUnit = 'day' | 'week' | 'month'

// Week layout, in Date.getDay() numbering (0 = Sunday .. 6 = Saturday)
export interface Calendar {
  weekStart: number
  workdays: number[]
}

export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5]

export const DEFAULT_CALENDAR: Calendar = { weekStart: 1, workdays: DEFAULT_WORKDAYS }

export const DAY_MS = 86400000

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = startOfDay(d)
  x.setDate(x.getDate() + n)
  return x
}

// Moves a date by whole calendar days, keeping its time of day (unlike
// addDays), so a DST change in between never moves the wall clock.
export function shiftDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Rounded so DST transitions never shift a day by an hour.
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

export function startOfWeek(d: Date, weekStart = 1): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() - weekStart + 7) % 7 // days since the week started
  x.setDate(x.getDate() - dow)
  return x
}

export function startOfMonth(d: Date): Date {
  const x = startOfDay(d)
  x.setDate(1)
  return x
}

export function isWorkday(d: Date, workdays: readonly number[] = DEFAULT_WORKDAYS): boolean {
  return workdays.includes(d.getDay())
}

export function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

// Local calendar day as YYYY-MM-DD (toISOString would give the UTC day).
export function isoDay(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Short day label: "14 Oct".
export function fmtShort(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function nextUnitStart(d: Date, unit: TimeUnit): Date {
  return unit === 'day' ? addDays(d, 1) :
    unit === 'week' ? addDays(d, 7) :
    new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

// Start dates of every visible unit column, from the unit containing `from`
// through the unit containing `to`.
export function unitStarts(from: Date, to: Date, unit: TimeUnit, weekStart = 1): Date[] {
  const out: Date[] = []
  let cur =
    unit === 'day' ? startOfDay(from) :
    unit === 'week' ? startOfWeek(from, weekStart) :
    startOfMonth(from)
  const last = startOfDay(to)
  while (cur <= last) {
    out.push(cur)
    cur = nextUnitStart(cur, unit)
  }
  return out
}

// unitStarts plus the start of the unit after the last one, i.e. n + 1 bucket
// boundaries for n buckets.
export function unitBoundaries(from: Date, to: Date, unit: TimeUnit, weekStart = 1): Date[] {
  const starts = unitStarts(from, to, unit, weekStart)
  if (starts.length === 0) return []
  return [...starts, nextUnitStart(starts[starts.length - 1], unit)]
}

export function autoUnit(from: Date, to: Date): TimeUnit {
  const days = daysBetween(from, to) + 1
  if (days <= 60) return 'day'
  if (days <= 550) return 'week'
  return 'month'
}

// "just now", "5 min ago", "3 h ago", "4 days ago"; "never" without a time
export function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return 'never'
  const min = Math.round((now - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
