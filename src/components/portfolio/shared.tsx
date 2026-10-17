import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Assignee, GanttTask } from '../../types'
import { addDays, startOfMonth, startOfWeek, type TimeUnit } from '../../lib/dates'
import { fitWindow } from '../../lib/exportGantt'
import type { WorkloadMetric } from '../../lib/workload'
import type { PortfolioProject } from '../../lib/portfolioData'

/* ------------------------------------------------------------ tooltip */

export interface TipState {
  x: number
  y: number
  content: ReactNode
}

// One floating tooltip per chart, positioned next to the pointer (viewport
// coordinates, so it is never clipped by a scroll box).
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  return { tip, show, hide }
}

export function Tooltip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    const left = tip.x + 14 + w > window.innerWidth ? tip.x - 14 - w : tip.x + 14
    const top = Math.min(tip.y + 14, window.innerHeight - h - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [tip])
  if (!tip) return null
  return (
    <div ref={ref} className="pf-tip" style={pos} role="tooltip">
      {tip.content}
    </div>
  )
}

/* -------------------------------------------------------------- sizing */

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/* -------------------------------------------------------------- ranges */

export type RangePreset = 'next3' | 'around' | 'year' | 'fit'

export const RANGE_LABEL: Record<RangePreset, string> = {
  next3: 'Next 3 months',
  around: '-1 to +5 months',
  year: '12 months',
  fit: 'All dates',
}

export function presetRange(
  preset: RangePreset, today: Date, tasks: GanttTask[], weekStart?: number,
): { from: Date; to: Date } {
  const m = (n: number) => new Date(today.getFullYear(), today.getMonth() + n, today.getDate())
  switch (preset) {
    case 'next3': return { from: startOfWeek(today, weekStart), to: m(3) }
    case 'around': return { from: startOfMonth(m(-1)), to: m(5) }
    case 'year': return { from: startOfMonth(m(-1)), to: m(11) }
    case 'fit': {
      const w = fitWindow(tasks, 'week', weekStart)
      return { from: w.from < today ? w.from : startOfWeek(today, weekStart), to: w.to > today ? w.to : addDays(today, 28) }
    }
  }
}

export const UNIT_LABEL: Record<TimeUnit, string> = { day: 'Day', week: 'Week', month: 'Month' }

/* --------------------------------------------------------------- values */

export function fmtValue(metric: WorkloadMetric, v: number): string {
  if (metric === 'count') return String(Math.round(v * 10) / 10)
  return v >= 100 ? `${Math.round(v)} h` : `${Math.round(v * 10) / 10} h`
}

export const metricLabel = (metric: WorkloadMetric): string =>
  metric === 'count' ? 'Active tasks' : 'Estimated hours'

/* ------------------------------------------------------------ assignees */

export const UNASSIGNED_KEY = 'unassigned'

// Real ClickUp users are keyed by id; legacy string assignees (id -1) only
// have a name to go by.
export const assigneeKey = (a: Assignee): string => (a.id === -1 ? `n:${a.username}` : `u:${a.id}`)

export function assigneeKeys(t: GanttTask): string[] {
  const keys = (t.assignees ?? []).map(assigneeKey)
  return keys.length ? [...new Set(keys)] : [UNASSIGNED_KEY]
}

export function assigneeNames(projects: PortfolioProject[]): Map<string, string> {
  const out = new Map<string, string>([[UNASSIGNED_KEY, 'Unassigned']])
  for (const p of projects) for (const t of p.tasks) for (const a of t.assignees ?? []) {
    out.set(assigneeKey(a), a.username)
  }
  return out
}

export function initials(name: string): string {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]!.toUpperCase()).join('') || '?'
}

/* -------------------------------------------------------------- links */

export const clickupTaskUrl = (clickupId: string) => `https://app.clickup.com/t/${clickupId}`
export const clickupListUrl = (teamId: string, listId: string) => `https://app.clickup.com/${teamId}/v/li/${listId}`

/* ------------------------------------------------------------ controls */

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="pf-seg" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" className={value === k ? 'is-on' : ''}
          aria-pressed={value === k} onClick={() => onChange(k)}>
          {text}
        </button>
      ))}
    </div>
  )
}

// "Nice" axis ticks: 0 .. max in steps of 1 / 2 / 2.5 / 5 x 10^n
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw)!
  const ticks: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
}
