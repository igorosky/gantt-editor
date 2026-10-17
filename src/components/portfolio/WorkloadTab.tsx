import { useMemo, useState } from 'react'
import { MONTHS, addDays, fmtDate, fmtShort, unitBoundaries, type TimeUnit } from '../../lib/dates'
import { OTHER_COLOR, PROJECT_COLORS, type PortfolioProject, type PortfolioTask } from '../../lib/portfolioData'
import { computeWorkload, type WorkloadBucket, type WorkloadMetric } from '../../lib/workload'
import { Legend, StackedBarChart, type BarBucket, type Series } from './StackedBarChart'
import { TaskDrillList, type DrillRow } from './TaskDrillList'
import {
  RANGE_LABEL, Seg, UNASSIGNED_KEY, UNIT_LABEL, assigneeKeys, assigneeNames, fmtValue, metricLabel,
  presetRange, type RangePreset,
} from './shared'
import { withoutBacklog, workdayLabel, type Settings } from '../../lib/settings'

interface Props {
  projects: PortfolioProject[]
  today: Date
  settings: Settings
}

const OTHER_KEY = 'other'
const UNASSIGNED_COLOR = '#c3c2b7'
const MAX_SERIES = PROJECT_COLORS.length

export function bucketLabels(b: { start: Date; end: Date }, unit: TimeUnit): { label: string; title: string } {
  const last = addDays(b.end, -1)
  if (unit === 'day') return { label: fmtShort(b.start), title: fmtDate(b.start) }
  if (unit === 'week') return { label: fmtShort(b.start), title: `${fmtShort(b.start)} - ${fmtShort(last)} ${last.getFullYear()}` }
  const m = MONTHS[b.start.getMonth()]
  return {
    label: b.start.getMonth() === 0 ? `${m} ${b.start.getFullYear()}` : m,
    title: `${m} ${b.start.getFullYear()}`,
  }
}

export const containsDay = (b: WorkloadBucket, d: Date) => b.start <= d && d < b.end

type Drill = { kind: 'bucket'; index: number } | { kind: 'noEstimate' } | { kind: 'undated' } | null

export function WorkloadTab({ projects, today, settings }: Props) {
  const [metric, setMetric] = useState<WorkloadMetric>('count')
  const [unit, setUnit] = useState<TimeUnit>('week')
  const [scope, setScope] = useState<string>('all')
  const [includeDone, setIncludeDone] = useState(false)
  const [range, setRange] = useState<RangePreset>('around')
  const [drill, setDrill] = useState<Drill>(null)

  const scopeProject = scope === 'all' ? null : projects.find(p => p.ref.listId === scope) ?? null
  const tasks = useMemo(
    () => withoutBacklog(scopeProject ? scopeProject.tasks : projects.flatMap(p => p.tasks), settings, 'workload'),
    [projects, scopeProject, settings],
  )
  const taskById = useMemo(() => new Map<string, PortfolioTask>(tasks.map(t => [`${t.projectId}:${t.id}`, t])), [tasks])
  const projectById = useMemo(() => new Map(projects.map(p => [p.ref.listId, p])), [projects])
  const names = useMemo(() => assigneeNames(projects), [projects])

  const { weekStart, workdays } = settings.calendar
  const { from, to } = useMemo(() => presetRange(range, today, tasks, weekStart), [range, today, tasks, weekStart])
  const boundaries = useMemo(() => unitBoundaries(from, to, unit, weekStart), [from, to, unit, weekStart])

  // Projects past the eighth color slot share the neutral "Other" series
  const folded = useMemo(
    () => new Set(projects.filter(p => p.color === OTHER_COLOR).map(p => p.ref.listId)),
    [projects],
  )

  const result = useMemo(() => computeWorkload(
    // Task ids are only unique within a project, so the engine gets a
    // project-qualified id to key drill-downs on
    tasks.map(t => ({
      ...t,
      id: `${t.projectId}:${t.id}`,
      parentId: t.parentId && `${t.projectId}:${t.parentId}`,
    })),
    boundaries,
    {
      metric,
      includeDone,
      workdays,
      keysOf: scopeProject
        ? assigneeKeys
        : t => [folded.has((t as PortfolioTask).projectId) ? OTHER_KEY : (t as PortfolioTask).projectId],
    },
  ), [tasks, boundaries, metric, includeDone, workdays, scopeProject, folded])

  // Series: projects in their own colors, or assignees (heaviest first, folded
  // past the palette, then colored in name order so a color tracks the person)
  const { series, foldKey } = useMemo(() => {
    if (!scopeProject) {
      const s: Series[] = projects.filter(p => !folded.has(p.ref.listId))
        .map(p => ({ key: p.ref.listId, label: p.ref.name, color: p.color }))
      if (folded.size) s.push({ key: OTHER_KEY, label: `Other (${folded.size})`, color: OTHER_COLOR })
      return { series: s, foldKey: (k: string) => k }
    }
    const people = result.keys.filter(k => k !== UNASSIGNED_KEY)
    const keep = new Set(people.length > MAX_SERIES ? people.slice(0, MAX_SERIES - 1) : people)
    const s: Series[] = [...keep]
      .sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b))
      .map((k, i) => ({ key: k, label: names.get(k) ?? k, color: PROJECT_COLORS[i] }))
    const rest = people.length - keep.size
    if (rest > 0) s.push({ key: OTHER_KEY, label: `Other (${rest})`, color: OTHER_COLOR })
    if (result.keys.includes(UNASSIGNED_KEY)) s.push({ key: UNASSIGNED_KEY, label: 'Unassigned', color: UNASSIGNED_COLOR })
    return {
      series: s,
      foldKey: (k: string) => (k === UNASSIGNED_KEY || keep.has(k) ? k : OTHER_KEY),
    }
  }, [scopeProject, projects, folded, result.keys, names])

  const bars: BarBucket[] = useMemo(() => result.buckets.map(b => {
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(b.byKey)) {
      const fk = foldKey(k)
      values[fk] = (values[fk] ?? 0) + v
    }
    return { ...bucketLabels(b, unit), values, total: b.total, isToday: containsDay(b, today) }
  }), [result, foldKey, unit, today])

  // How many projects have work running in each bucket
  const band = useMemo(() => {
    if (scopeProject) return undefined
    const values = result.buckets.map(b => new Set(b.items.map(it => taskById.get(it.taskId)?.projectId)).size)
    return { label: 'Projects', values, max: Math.max(1, ...values) }
  }, [scopeProject, result, taskById])

  const peakIdx = bars.reduce((best, b, i) => (b.total > (bars[best]?.total ?? -1) ? i : best), 0)
  const nowIdx = bars.findIndex(b => b.isToday)
  const fmt = (v: number) => fmtValue(metric, v)

  const drillRows = useMemo((): { title: string; rows: DrillRow[] } | null => {
    if (!drill) return null
    if (drill.kind === 'bucket') {
      const b = result.buckets[drill.index]
      if (!b) return null
      const agg = new Map<string, number>()
      for (const it of b.items) agg.set(it.taskId, (agg.get(it.taskId) ?? 0) + it.value)
      return {
        title: bars[drill.index].title,
        rows: [...agg].flatMap(([id, value]) => {
          const task = taskById.get(id)
          return task ? [{ task, value }] : []
        }),
      }
    }
    const ids = drill.kind === 'noEstimate' ? result.missingEstimate : result.skippedUndated
    return {
      title: drill.kind === 'noEstimate' ? 'Tasks without a time estimate' : 'Tasks without dates',
      rows: ids.flatMap(id => { const task = taskById.get(id); return task ? [{ task, value: 0 }] : [] }),
    }
  }, [drill, result, bars, taskById])

  return (
    <div className="pf-workload">
      <div className="pf-controls">
        <Seg label="Metric" value={metric} onChange={v => { setMetric(v); setDrill(null) }}
          options={[['count', 'Tasks'], ['hours', 'Est. hours']]} />
        <Seg label="Bucket size" value={unit} onChange={v => { setUnit(v); setDrill(null) }}
          options={(['day', 'week', 'month'] as TimeUnit[]).map(u => [u, UNIT_LABEL[u]])} />
        <label className="pf-select">
          <span>Scope</span>
          <select value={scopeProject ? scope : 'all'} onChange={e => { setScope(e.target.value); setDrill(null) }}>
            <option value="all">All projects (by project)</option>
            {projects.map(p => <option key={p.ref.listId} value={p.ref.listId}>{p.ref.name} (by person)</option>)}
          </select>
        </label>
        <label className="pf-select">
          <span>Range</span>
          <select value={range} onChange={e => { setRange(e.target.value as RangePreset); setDrill(null) }}>
            {(Object.keys(RANGE_LABEL) as RangePreset[]).map(k => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="pf-check">
          <input type="checkbox" checked={includeDone} onChange={e => setIncludeDone(e.target.checked)} />
          Include done
        </label>
      </div>

      <section className="pf-card">
        <div className="pf-card__head">
          <h2 className="pf-card__title">
            {metricLabel(metric)} per {unit}{scopeProject ? ` - ${scopeProject.ref.name}` : ''}
          </h2>
          <div className="pf-spacer" />
          <div className="pf-stats">
            {nowIdx >= 0 && <span>Now <b>{fmt(bars[nowIdx].total)}</b></span>}
            {bars.length > 0 && <span>Peak <b>{fmt(bars[peakIdx].total)}</b> <span className="pf-muted">({bars[peakIdx].title})</span></span>}
          </div>
        </div>
        <Legend series={series} />
        <StackedBarChart
          buckets={bars}
          series={series}
          format={fmt}
          band={band}
          selected={drill?.kind === 'bucket' ? drill.index : null}
          onSelect={i => setDrill(i === null ? null : { kind: 'bucket', index: i })}
        />
        <div className="pf-notes">
          {result.skippedUndated.length > 0 && (
            <button type="button" className="pf-note-link" onClick={() => setDrill({ kind: 'undated' })}>
              {result.skippedUndated.length} task{result.skippedUndated.length === 1 ? '' : 's'} without dates not shown
            </button>
          )}
          {metric === 'hours' && result.missingEstimate.length > 0 && (
            <button type="button" className="pf-note-link" onClick={() => setDrill({ kind: 'noEstimate' })}>
              {result.missingEstimate.length} task{result.missingEstimate.length === 1 ? '' : 's'} without a time estimate not counted
            </button>
          )}
          <span className="pf-muted">
            {metric === 'count'
              ? 'A task counts once in every period it overlaps. Milestones excluded.'
              : `Each estimate is spread evenly over the working days (${workdayLabel(workdays)}) of the task and split between assignees.`}
          </span>
        </div>
      </section>

      {drillRows && (
        <TaskDrillList title={drillRows.title} rows={drillRows.rows} metric={metric}
          projects={projectById} today={today} onClose={() => setDrill(null)} />
      )}
    </div>
  )
}
