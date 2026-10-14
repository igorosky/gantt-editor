import { useMemo, useState } from 'react'
import { unitBoundaries, type TimeUnit } from '../../lib/dates'
import type { PortfolioProject, PortfolioTask } from '../../lib/portfolioData'
import { computeWorkload, workdaysIn, type WorkloadMetric } from '../../lib/workload'
import { TaskDrillList, type DrillRow } from './TaskDrillList'
import { bucketLabels, containsDay } from './WorkloadTab'
import {
  RANGE_LABEL, Seg, Tooltip, UNASSIGNED_KEY, UNIT_LABEL, assigneeKeys, assigneeNames, fmtValue,
  initials, metricLabel, presetRange, useTooltip, type RangePreset,
} from './shared'

interface Props {
  projects: PortfolioProject[]
  today: Date
}

// Sequential blue ramp, light to dark: share of capacity used
export const LOAD_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']
// Status "critical": reserved for over capacity, always paired with the ! mark
export const OVER_COLOR = '#d03b3b'

const CELL_MIN = 34
const NAME_COL = 190

function cellColor(ratio: number): { bg: string; fg: string } {
  if (ratio <= 0) return { bg: 'transparent', fg: 'var(--text-dim)' }
  if (ratio > 1) return { bg: OVER_COLOR, fg: '#fff' }
  const step = Math.min(LOAD_RAMP.length - 1, Math.max(0, Math.ceil(ratio * LOAD_RAMP.length) - 1))
  return { bg: LOAD_RAMP[step], fg: step >= 3 ? '#fff' : 'var(--text)' }
}

export function PeopleTab({ projects, today }: Props) {
  const [metric, setMetric] = useState<WorkloadMetric>('count')
  const [unit, setUnit] = useState<TimeUnit>('week')
  const [range, setRange] = useState<RangePreset>('around')
  const [hoursPerDay, setHoursPerDay] = useState(8)
  const [maxTasks, setMaxTasks] = useState(3)
  const [includeDone, setIncludeDone] = useState(false)
  const [sel, setSel] = useState<{ key: string; index: number } | null>(null)
  const { tip, show, hide } = useTooltip()

  const tasks = useMemo(() => projects.flatMap(p => p.tasks), [projects])
  const taskById = useMemo(() => new Map<string, PortfolioTask>(tasks.map(t => [`${t.projectId}:${t.id}`, t])), [tasks])
  const projectById = useMemo(() => new Map(projects.map(p => [p.ref.listId, p])), [projects])
  const names = useMemo(() => assigneeNames(projects), [projects])

  const { from, to } = useMemo(() => presetRange(range, today, tasks), [range, today, tasks])
  const boundaries = useMemo(() => unitBoundaries(from, to, unit), [from, to, unit])

  const result = useMemo(() => computeWorkload(
    tasks.map(t => ({ ...t, id: `${t.projectId}:${t.id}` })),
    boundaries,
    { metric, includeDone, keysOf: assigneeKeys },
  ), [tasks, boundaries, metric, includeDone])

  const capacity = useMemo(
    () => result.buckets.map(b => (metric === 'hours' ? hoursPerDay * workdaysIn(b.start, b.end) : maxTasks)),
    [result, metric, hoursPerDay, maxTasks],
  )
  const heads = useMemo(() => result.buckets.map(b => ({
    ...bucketLabels(b, unit), isToday: containsDay(b, today),
  })), [result, unit, today])

  const rows = useMemo(() => {
    const out = result.keys.map(key => {
      const values = result.buckets.map(b => b.byKey[key] ?? 0)
      const over = values.filter((v, i) => capacity[i] > 0 && v > capacity[i]).length
      return {
        key,
        name: names.get(key) ?? key,
        values,
        peak: Math.max(0, ...values.map((v, i) => (capacity[i] > 0 ? v / capacity[i] : 0))),
        total: values.reduce((a, b) => a + b, 0),
        over,
      }
    })
    // Most loaded first; unassigned work is not a person, so it goes last
    return out.sort((a, b) =>
      Number(a.key === UNASSIGNED_KEY) - Number(b.key === UNASSIGNED_KEY) || b.peak - a.peak || b.total - a.total)
  }, [result, capacity, names])

  const overPeople = rows.filter(r => r.key !== UNASSIGNED_KEY && r.over > 0).length
  const labelEvery = Math.max(1, Math.ceil(44 / CELL_MIN))
  const fmt = (v: number) => fmtValue(metric, v)
  const compact = (v: number) => (v < 1 ? v.toFixed(1) : String(Math.round(v)))

  function cellTip(row: (typeof rows)[number], i: number) {
    const b = result.buckets[i]
    const byProject = new Map<string, number>()
    for (const it of b.items) {
      if (it.key !== row.key) continue
      const pid = taskById.get(it.taskId)?.projectId ?? '?'
      byProject.set(pid, (byProject.get(pid) ?? 0) + it.value)
    }
    const v = row.values[i]
    const cap = capacity[i]
    return (
      <>
        <div className="pf-tip__title">{row.name} - {heads[i].title}</div>
        {[...byProject].sort((a, z) => z[1] - a[1]).map(([pid, pv]) => {
          const p = projectById.get(pid)
          return (
            <div key={pid} className="pf-tip__row">
              <span className="pf-dot pf-dot--sm" style={{ background: p?.color }} />
              <span className="pf-tip__label">{p?.ref.name ?? pid}</span>
              <span className="pf-tip__val">{fmt(pv)}</span>
            </div>
          )
        })}
        <div className="pf-tip__row pf-tip__total">
          <span className="pf-tip__label">Total / capacity</span>
          <span className="pf-tip__val">{fmt(v)} / {fmt(cap)}</span>
        </div>
        {cap > 0 && v > cap && <div className="pf-tip__warn">! Over capacity by {fmt(v - cap)}</div>}
        {v > 0 && <div className="pf-tip__hint">Click to list tasks</div>}
      </>
    )
  }

  const drill = useMemo((): { title: string; rows: DrillRow[] } | null => {
    if (!sel) return null
    const b = result.buckets[sel.index]
    if (!b) return null
    const agg = new Map<string, number>()
    for (const it of b.items) if (it.key === sel.key) agg.set(it.taskId, (agg.get(it.taskId) ?? 0) + it.value)
    return {
      title: `${names.get(sel.key) ?? sel.key} - ${heads[sel.index].title}`,
      rows: [...agg].flatMap(([id, value]) => { const task = taskById.get(id); return task ? [{ task, value }] : [] }),
    }
  }, [sel, result, names, heads, taskById])

  return (
    <div className="pf-people">
      <div className="pf-controls">
        <Seg label="Metric" value={metric} onChange={v => { setMetric(v); setSel(null) }}
          options={[['count', 'Tasks'], ['hours', 'Est. hours']]} />
        <Seg label="Bucket size" value={unit} onChange={v => { setUnit(v); setSel(null) }}
          options={(['day', 'week', 'month'] as TimeUnit[]).map(u => [u, UNIT_LABEL[u]])} />
        <label className="pf-select">
          <span>Range</span>
          <select value={range} onChange={e => { setRange(e.target.value as RangePreset); setSel(null) }}>
            {(Object.keys(RANGE_LABEL) as RangePreset[]).map(k => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
          </select>
        </label>
        {metric === 'hours' ? (
          <label className="pf-select" title="Working hours per person per working day (Mon-Fri)">
            <span>Capacity h/day</span>
            <input type="number" min={1} max={24} step={0.5} value={hoursPerDay}
              onChange={e => setHoursPerDay(Math.max(0.5, Number(e.target.value) || 8))} />
          </label>
        ) : (
          <label className="pf-select" title="More tasks than this in one period counts as over capacity">
            <span>Max tasks / period</span>
            <input type="number" min={1} max={50} value={maxTasks}
              onChange={e => setMaxTasks(Math.max(1, Math.round(Number(e.target.value)) || 3))} />
          </label>
        )}
        <label className="pf-check">
          <input type="checkbox" checked={includeDone} onChange={e => setIncludeDone(e.target.checked)} />
          Include done
        </label>
      </div>

      <section className="pf-card">
        <div className="pf-card__head">
          <h2 className="pf-card__title">{metricLabel(metric)} per person per {unit}</h2>
          <div className="pf-spacer" />
          <div className="pf-stats">
            <span><b>{rows.filter(r => r.key !== UNASSIGNED_KEY).length}</b> people</span>
            <span className={overPeople ? 'pf-late' : undefined}>
              <b>{overPeople}</b> over capacity at least once
            </span>
          </div>
        </div>
        <div className="pf-legend">
          <span className="pf-legend__item">Share of capacity</span>
          {LOAD_RAMP.map((c, i) => (
            <span key={c} className="pf-legend__item">
              <span className="pf-legend__swatch" style={{ background: c }} />
              {i === 0 ? 'low' : i === LOAD_RAMP.length - 1 ? 'full' : ''}
            </span>
          ))}
          <span className="pf-legend__item">
            <span className="pf-legend__swatch" style={{ background: OVER_COLOR }} />! Over capacity
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="pf-empty">No assigned, dated work in this range.</p>
        ) : (
          <div className="pf-heat-wrap">
            <table className="pf-heat" style={{ minWidth: NAME_COL + heads.length * CELL_MIN }}>
              <colgroup>
                <col style={{ width: NAME_COL }} />
                {heads.map((_, i) => <col key={i} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="pf-heat__name">Person</th>
                  {heads.map((h, i) => (
                    <th key={i} className={h.isToday ? 'is-today' : undefined} title={h.title}>
                      {i % labelEvery === 0 || h.isToday ? h.label : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    <th className="pf-heat__name" scope="row">
                      <span className={`pf-avatar${row.key === UNASSIGNED_KEY ? ' pf-avatar--none' : ''}`} aria-hidden="true">
                        {row.key === UNASSIGNED_KEY ? '?' : initials(row.name)}
                      </span>
                      <span className="pf-heat__person">{row.name}</span>
                      {row.over > 0 && row.key !== UNASSIGNED_KEY && (
                        <span className="pf-heat__over" title={`Over capacity in ${row.over} period${row.over === 1 ? '' : 's'}`}>
                          ! {row.over}
                        </span>
                      )}
                    </th>
                    {row.values.map((v, i) => {
                      // Unassigned work has no capacity to compare against
                      const unassigned = row.key === UNASSIGNED_KEY
                      const ratio = capacity[i] > 0 ? v / capacity[i] : 0
                      const over = !unassigned && ratio > 1
                      const { bg, fg } = unassigned
                        ? { bg: v > 0 ? 'var(--surface-3)' : 'transparent', fg: 'var(--text-mid)' }
                        : cellColor(ratio)
                      const isSel = sel?.key === row.key && sel.index === i
                      return (
                        <td key={i}
                          className={`pf-heat__cell${heads[i].isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}${v > 0 ? ' has-load' : ''}`}
                          style={{ background: bg, color: fg }}
                          onMouseMove={e => show(e, cellTip(row, i))}
                          onMouseLeave={hide}
                          onClick={() => v > 0 && setSel(isSel ? null : { key: row.key, index: i })}>
                          {v > 0 ? `${over ? '!' : ''}${compact(v)}` : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pf-notes">
          <span className="pf-muted">
            {metric === 'count'
              ? 'Tasks a person has running in each period, across all selected projects. Every assignee counts the task fully.'
              : 'Estimated hours spread over each task\'s working days and split between its assignees. Capacity = hours/day x working days.'}
          </span>
          {metric === 'hours' && result.missingEstimate.length > 0 && (
            <span className="pf-muted">
              {result.missingEstimate.length} task{result.missingEstimate.length === 1 ? '' : 's'} without an estimate {result.missingEstimate.length === 1 ? 'is' : 'are'} not counted.
            </span>
          )}
        </div>
      </section>

      {drill && (
        <TaskDrillList title={drill.title} rows={drill.rows} metric={metric}
          projects={projectById} today={today} onClose={() => setSel(null)} />
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
