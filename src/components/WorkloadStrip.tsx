import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GanttTask } from '../types'
import type { GanttGeometry } from './GanttPanel'
import { DAY_MS, addDays, fmtShort } from '../lib/dates'
import { computeWorkload, type WorkloadMetric } from '../lib/workload'
import {
  Seg, Tooltip, assigneeKey, assigneeKeys, fmtValue, initials, useTooltip, UNASSIGNED_KEY,
} from './portfolio/shared'

interface Props {
  tasks: GanttTask[]
  geometry: GanttGeometry | null
  container: HTMLElement | null // frappe-gantt's .gantt-container
  metric: WorkloadMetric
  onMetric: (m: WorkloadMetric) => void
  onClose: () => void
}

export const STRIP_H = 96
const PLOT_TOP = 18
const PLOT_BOTTOM = 8
const MAX_BAR = 24
const BAR_COLOR = '#2a78d6'

// Workload of the current board drawn under the gantt, one bar per gantt
// column. It sits below the whole split body so both panels lose the same
// height and the pixel-based LHS / RHS scroll sync stays aligned.
export function WorkloadStrip({ tasks, geometry, container, metric, onMetric, onClose }: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<{ left: number; width: number } | null>(null)
  const { tip, show, hide } = useTooltip()
  const [today] = useState(() => new Date())

  // Line the plot up with the gantt container, wherever the divider sits
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip || !container) return
    const measure = () => {
      const a = strip.getBoundingClientRect()
      const b = container.getBoundingClientRect()
      setBox({ left: b.left - a.left, width: container.clientWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [container])

  // Mirror the gantt's horizontal scroll without re-rendering
  useEffect(() => {
    if (!container) return
    const sync = () => {
      if (plotRef.current) plotRef.current.style.transform = `translateX(${-container.scrollLeft}px)`
    }
    sync()
    container.addEventListener('scroll', sync, { passive: true })
    return () => container.removeEventListener('scroll', sync)
  }, [container, geometry])

  const result = useMemo(() => {
    if (!geometry || geometry.dates.length < 2) return null
    const { dates } = geometry
    const stepDays = Math.round((dates[1].getTime() - dates[0].getTime()) / DAY_MS)
    const bounds = [...dates, addDays(dates[dates.length - 1], stepDays)]
    return computeWorkload(tasks, bounds, { metric, keysOf: assigneeKeys })
  }, [tasks, geometry, metric])

  const names = useMemo(() => {
    const m = new Map<string, string>([[UNASSIGNED_KEY, 'Unassigned']])
    for (const t of tasks) for (const a of t.assignees ?? []) m.set(assigneeKey(a), a.username)
    return m
  }, [tasks])

  const colW = geometry?.columnWidth ?? 0
  const width = (geometry?.dates.length ?? 0) * colW
  const plotH = STRIP_H - PLOT_TOP - PLOT_BOTTOM
  const barW = Math.min(MAX_BAR, colW * 0.6)
  const nowIdx = result?.buckets.findIndex(b => b.start <= today && today < b.end) ?? -1
  const fmt = (v: number) => fmtValue(metric, v)

  function tipFor(i: number) {
    const b = result!.buckets[i]
    const people = Object.entries(b.byKey).sort((a, z) => z[1] - a[1])
    return (
      <>
        <div className="pf-tip__title">Week of {fmtShort(b.start)}</div>
        {people.map(([k, v]) => (
          <div key={k} className="pf-tip__row">
            <span className="pf-avatar pf-avatar--xs" aria-hidden="true">{k === UNASSIGNED_KEY ? '?' : initials(names.get(k) ?? k)}</span>
            <span className="pf-tip__label">{names.get(k) ?? k}</span>
            <span className="pf-tip__val">{fmt(v)}</span>
          </div>
        ))}
        <div className="pf-tip__row pf-tip__total">
          <span className="pf-tip__label">{metric === 'count' ? 'Tasks running' : 'Estimated hours'}</span>
          <span className="pf-tip__val">{metric === 'count' ? new Set(b.items.map(it => it.taskId)).size : fmt(b.total)}</span>
        </div>
      </>
    )
  }

  // Count per bucket is distinct tasks; byKey can count a task once per assignee
  const barValue = (i: number) => {
    const b = result!.buckets[i]
    return metric === 'count' ? new Set(b.items.map(it => it.taskId)).size : b.total
  }
  const values = result ? result.buckets.map((_, i) => barValue(i)) : []
  const top = Math.max(1, ...values)
  const peakIdx = values.some(v => v > 0) ? values.indexOf(Math.max(...values)) : -1

  return (
    <div className="load-strip" ref={stripRef} style={{ height: STRIP_H }}>
      <div className="load-strip__lhs" style={{ width: box?.left ?? 0 }}>
        <div className="load-strip__title">
          Workload
          <button type="button" className="load-strip__close" onClick={onClose} aria-label="Hide workload">✕</button>
        </div>
        <Seg label="Workload metric" value={metric} onChange={onMetric}
          options={[['count', 'Tasks'], ['hours', 'Est. hours']]} />
        <div className="load-strip__meta">
          {metric === 'count' ? 'Tasks running per week' : 'Estimated hours per week'}
          {metric === 'hours' && result && result.missingEstimate.length > 0 && (
            <span title="Tasks without a ClickUp time estimate are not counted"> · {result.missingEstimate.length} w/o estimate</span>
          )}
        </div>
      </div>
      <div className="load-strip__plot" style={{ left: box?.left ?? 0, width: box?.width ?? 0 }}>
        {result && (
          <svg ref={plotRef} width={width} height={STRIP_H} className="load-strip__svg">
            {values.map((v, i) => {
              const cx = i * colW + colW / 2
              const h = (v / top) * plotH
              const isNow = i === nowIdx
              return (
                <g key={i} onMouseMove={e => show(e, tipFor(i))} onMouseLeave={hide}>
                  <rect x={i * colW} y={0} width={colW} height={STRIP_H} className={`load-strip__hit${isNow ? ' is-now' : ''}`} />
                  {h > 0 && (
                    <path d={`M${cx - barW / 2},${PLOT_TOP + plotH}V${PLOT_TOP + plotH - h + Math.min(4, h)}` +
                      `Q${cx - barW / 2},${PLOT_TOP + plotH - h} ${cx - barW / 2 + Math.min(4, h)},${PLOT_TOP + plotH - h}` +
                      `H${cx + barW / 2 - Math.min(4, h)}Q${cx + barW / 2},${PLOT_TOP + plotH - h} ${cx + barW / 2},${PLOT_TOP + plotH - h + Math.min(4, h)}` +
                      `V${PLOT_TOP + plotH}Z`} fill={BAR_COLOR} />
                  )}
                  {(i === peakIdx || isNow) && v > 0 && (
                    <text x={cx} y={PLOT_TOP + plotH - h - 4} textAnchor="middle" className="load-strip__val">
                      {isNow && i !== peakIdx ? `now ${fmt(v)}` : i === peakIdx && !isNow ? `peak ${fmt(v)}` : fmt(v)}
                    </text>
                  )}
                </g>
              )
            })}
            <line x1={0} x2={width} y1={PLOT_TOP + plotH + 0.5} y2={PLOT_TOP + plotH + 0.5} className="pf-axis" />
          </svg>
        )}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}
