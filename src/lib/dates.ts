// Local-time calendar helpers shared by the export renderer and the portfolio
// views. Everything works on whole days at local midnight.

export type TimeUnit = 'day' | 'week' | 'month'

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

// Rounded so DST transitions never shift a day by an hour.
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - dow)
  return x
}

export function startOfMonth(d: Date): Date {
  const x = startOfDay(d)
  x.setDate(1)
  return x
}

export function isWorkday(d: Date): boolean {
  const dow = d.getDay()
  return dow !== 0 && dow !== 6
}

export function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
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
export function unitStarts(from: Date, to: Date, unit: TimeUnit): Date[] {
  const out: Date[] = []
  let cur =
    unit === 'day' ? startOfDay(from) :
    unit === 'week' ? startOfWeek(from) :
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
export function unitBoundaries(from: Date, to: Date, unit: TimeUnit): Date[] {
  const starts = unitStarts(from, to, unit)
  if (starts.length === 0) return []
  return [...starts, nextUnitStart(starts[starts.length - 1], unit)]
}

export function autoUnit(from: Date, to: Date): TimeUnit {
  const days = daysBetween(from, to) + 1
  if (days <= 60) return 'day'
  if (days <= 550) return 'week'
  return 'month'
}
