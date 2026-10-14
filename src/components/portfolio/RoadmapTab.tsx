import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { GanttTask } from '../../types'
import { MONTHS, daysBetween, fmtDate, fmtShort, unitStarts } from '../../lib/dates'
import { fitWindow } from '../../lib/exportGantt'
import { isDone, isOverdue, projectHealth, type ProjectHealth } from '../../lib/portfolio'
import type { PortfolioProject, PortfolioTask } from '../../lib/portfolioData'
import { RagPill } from './OverviewTab'
import { OVER_COLOR } from './PeopleTab'
import { Seg, Tooltip, useTooltip } from './shared'

interface Props {
  projects: PortfolioProject[]
  today: Date
}

type Zoom = 'week' | 'month'

const PX_PER_DAY: Record<Zoom, number> = { week: 16, month: 4 }
const LHS_W = 300
const BAND_H = 22
const HEAD_H = BAND_H * 2
const PROJECT_H = 44
const TASK_H = 26
const MS_SIZE = 11

type Row =
  | { kind: 'project'; p: PortfolioProject; h: ProjectHealth }
  | { kind: 'task'; p: PortfolioProject; t: PortfolioTask }
  | { kind: 'undated'; p: PortfolioProject; n: number }

const rowH = (r: Row) => (r.kind === 'project' ? PROJECT_H : TASK_H)

export function RoadmapTab({ projects, today }: Props) {
  const [zoom, setZoom] = useState<Zoom>('week')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const { tip, show, hide } = useTooltip()
  const scrollRef = useRef<HTMLDivElement>(null)

  const healths = useMemo(
    () => new Map(projects.map(p => [p.ref.listId, projectHealth(p.tasks, today)])),
    [projects, today],
  )

  const { from, to } = useMemo(() => {
    const todayTask: GanttTask = { id: 'today', name: '', progress: 0, start: today, end: today }
    return fitWindow([...projects.flatMap(p => p.tasks), todayTask], zoom)
  }, [projects, today, zoom])

  const px = PX_PER_DAY[zoom]
  const width = (daysBetween(from, to) + 1) * px
  const x = (d: Date) => daysBetween(from, d) * px
  const todayX = x(today) + px / 2

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const p of projects) {
      out.push({ kind: 'project', p, h: healths.get(p.ref.listId)! })
      if (!expanded.has(p.ref.listId)) continue
      const dated = p.tasks.filter(t => t.start || t.end)
        .sort((a, b) => ((a.start ?? a.end)!.getTime() - (b.start ?? b.end)!.getTime()))
      for (const t of dated) out.push({ kind: 'task', p, t })
      const undated = p.tasks.length - dated.length
      if (undated) out.push({ kind: 'undated', p, n: undated })
    }
    return out
  }, [projects, healths, expanded])

  const tops = useMemo(() => {
    let y = 0
    return rows.map(r => { const top = y; y += rowH(r); return top })
  }, [rows])
  const bodyH = rows.reduce((s, r) => s + rowH(r), 0)

  const upper = useMemo(() => {
    const starts = zoom === 'week'
      ? unitStarts(from, to, 'month')
      : (() => { const out: Date[] = []; for (let y = from.getFullYear(); y <= to.getFullYear(); y++) out.push(new Date(y, 0, 1)); return out })()
    return starts.map(s => ({
      x: Math.max(0, x(s)),
      label: zoom === 'week' ? `${MONTHS[s.getMonth()]} ${s.getFullYear()}` : String(s.getFullYear()),
    }))
  }, [from, to, zoom]) // eslint-disable-line react-hooks/exhaustive-deps
  const lower = useMemo(
    () => unitStarts(from, to, zoom).map(s => ({
      x: x(s) < 0 ? 0 : x(s),
      label: zoom === 'week' ? fmtShort(s) : MONTHS[s.getMonth()],
    })),
    [from, to, zoom], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Open on today
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - LHS_W) / 3)
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOpen = projects.length > 0 && projects.every(p => expanded.has(p.ref.listId))

  function barSpan(s?: Date, e?: Date): { x: number; w: number } | null {
    const a = s ?? e
    const b = e ?? s
    if (!a || !b) return null
    return { x: x(a), w: Math.max(px, (daysBetween(a, b) + 1) * px) }
  }

  function diamond(cx: number, cy: number, size: number, fill: string, key: string, onTip: (e: React.MouseEvent) => void) {
    const r = size / 2
    return (
      <path key={key} d={`M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`}
        fill={fill} className="pf-rm__ms" onMouseMove={onTip} onMouseLeave={hide} />
    )
  }

  function taskTip(t: PortfolioTask, p: PortfolioProject) {
    const late = isOverdue(t, today)
    return (
      <>
        <div className="pf-tip__title">{t.type === 'milestone' ? '◆ ' : ''}{t.name}</div>
        <div className="pf-tip__row"><span className="pf-tip__label">Project</span><span className="pf-tip__val">{p.ref.name}</span></div>
        <div className="pf-tip__row">
          <span className="pf-tip__label">{t.type === 'milestone' ? 'Date' : 'Dates'}</span>
          <span className="pf-tip__val">
            {t.type === 'milestone' || !t.start ? fmtDate((t.end ?? t.start)!) : `${fmtDate(t.start)} - ${t.end ? fmtDate(t.end) : '?'}`}
          </span>
        </div>
        {t.status && <div className="pf-tip__row"><span className="pf-tip__label">Status</span><span className="pf-tip__val">{t.status}</span></div>}
        {!!t.assignees?.length && (
          <div className="pf-tip__row"><span className="pf-tip__label">Assignees</span>
            <span className="pf-tip__val">{t.assignees.map(a => a.username).join(', ')}</span></div>
        )}
        {late && <div className="pf-tip__warn">✕ Overdue by {daysBetween(t.end!, today)} days</div>}
      </>
    )
  }

  function projectTip(p: PortfolioProject, h: ProjectHealth) {
    return (
      <>
        <div className="pf-tip__title">{p.ref.name}</div>
        <div className="pf-tip__row"><span className="pf-tip__label">Span</span>
          <span className="pf-tip__val">{h.start ? fmtDate(h.start) : '?'} - {h.end ? fmtDate(h.end) : '?'}</span></div>
        <div className="pf-tip__row"><span className="pf-tip__label">Done</span>
          <span className="pf-tip__val">{h.done} / {h.total} ({Math.round(h.donePct * 100)}%)</span></div>
        <div className="pf-tip__row"><span className="pf-tip__label">Overdue</span><span className="pf-tip__val">{h.overdue}</span></div>
        {h.ragReasons.map(r => <div key={r} className="pf-tip__warn">{h.rag === 'red' ? '✕' : '!'} {r}</div>)}
      </>
    )
  }

  return (
    <div className="pf-roadmap">
      <div className="pf-controls">
        <Seg label="Zoom" value={zoom} onChange={setZoom} options={[['week', 'Weeks'], ['month', 'Months']]} />
        <button type="button" className="pf-btn" onClick={() =>
          setExpanded(allOpen ? new Set() : new Set(projects.map(p => p.ref.listId)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <span className="pf-muted pf-roadmap__hint">
          Bar = first start to last due date, dark part = share of tasks done. ◆ milestones; red = overdue.
        </span>
      </div>

      <div className="pf-card pf-rm-card">
        <div className="pf-rm-scroll" ref={scrollRef}>
          <div className="pf-rm" style={{ width: LHS_W + width }}>
            <div className="pf-rm__header" style={{ height: HEAD_H }}>
              <div className="pf-rm__corner" style={{ width: LHS_W }}>Project</div>
              <svg width={width} height={HEAD_H} className="pf-rm__svg">
                {upper.map((u, i) => (
                  <g key={i}>
                    <line x1={u.x} x2={u.x} y1={0} y2={BAND_H} className="pf-grid" />
                    <text x={u.x + 6} y={15} className="pf-rm__band">{u.label}</text>
                  </g>
                ))}
                <line x1={0} x2={width} y1={BAND_H} y2={BAND_H} className="pf-grid" />
                {lower.map((u, i) => (
                  <g key={i}>
                    <line x1={u.x} x2={u.x} y1={BAND_H} y2={HEAD_H} className="pf-grid" />
                    <text x={u.x + 4} y={BAND_H + 15} className="pf-tick">{u.label}</text>
                  </g>
                ))}
                <rect x={todayX - 18} y={BAND_H + 3} width={36} height={16} rx={8} className="pf-rm__today-chip" />
                <text x={todayX} y={BAND_H + 15} textAnchor="middle" className="pf-rm__today-text">Today</text>
              </svg>
            </div>

            <div className="pf-rm__body">
              <div className="pf-rm__lhs" style={{ width: LHS_W }}>
                {rows.map((r, i) => {
                  if (r.kind === 'project') {
                    const open = expanded.has(r.p.ref.listId)
                    return (
                      <div key={i} className="pf-rm__lrow pf-rm__lrow--project" style={{ height: PROJECT_H }}>
                        <button type="button" className="pf-rm__toggle" onClick={() => toggle(r.p.ref.listId)}
                          aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${r.p.ref.name}`}>
                          {open ? '▾' : '▸'}
                        </button>
                        <span className="pf-dot" style={{ background: r.p.color }} />
                        <span className="pf-rm__pname" title={r.p.ref.name}>{r.p.ref.name}</span>
                        <RagPill rag={r.h.rag} reasons={r.h.ragReasons} />
                      </div>
                    )
                  }
                  if (r.kind === 'task') {
                    const late = isOverdue(r.t, today)
                    return (
                      <div key={i} className={`pf-rm__lrow pf-rm__lrow--task${isDone(r.t) ? ' is-done' : ''}`} style={{ height: TASK_H }}>
                        <span className="pf-dot pf-dot--sm" style={{ background: r.t.statusColor ?? r.p.color }} />
                        <span className={`pf-rm__tname${late ? ' pf-late' : ''}`} title={r.t.name}>
                          {r.t.type === 'milestone' ? '◆ ' : ''}{r.t.name}
                        </span>
                      </div>
                    )
                  }
                  return (
                    <div key={i} className="pf-rm__lrow pf-rm__lrow--task pf-muted" style={{ height: TASK_H }}>
                      {r.n} task{r.n === 1 ? '' : 's'} without dates
                    </div>
                  )
                })}
              </div>

              <svg width={width} height={bodyH} className="pf-rm__svg">
                {lower.map((u, i) => <line key={i} x1={u.x} x2={u.x} y1={0} y2={bodyH} className="pf-grid" />)}
                {rows.map((r, i) => (
                  r.kind === 'project'
                    ? <line key={`sep${i}`} x1={0} x2={width} y1={tops[i]} y2={tops[i]} className="pf-grid" />
                    : null
                ))}

                {rows.map((r, i) => {
                  const top = tops[i]
                  if (r.kind === 'project') {
                    const span = barSpan(r.h.start, r.h.end)
                    const cy = top + PROJECT_H / 2
                    const pct = r.h.donePct
                    const ms = r.p.tasks.filter(t => t.type === 'milestone' && (t.end ?? t.start))
                    return (
                      <g key={i}>
                        {span && (
                          <g onMouseMove={e => show(e, projectTip(r.p, r.h))} onMouseLeave={hide} className="pf-rm__pbar">
                            <rect x={span.x} y={cy - 8} width={span.w} height={16} rx={4}
                              fill={r.p.color} fillOpacity={0.28}
                              stroke={r.h.rag === 'red' ? OVER_COLOR : 'none'} strokeWidth={2} />
                            {pct > 0 && (
                              <rect x={span.x} y={cy - 8} width={Math.max(4, span.w * pct)} height={16} rx={4} fill={r.p.color} />
                            )}
                            <text x={span.x + span.w + 8} y={cy + 4} className="pf-rm__plabel">
                              {Math.round(pct * 100)}%{r.h.overdue ? ` · ${r.h.overdue} overdue` : ''}
                            </text>
                          </g>
                        )}
                        {!span && <text x={8} y={cy + 4} className="pf-rm__plabel pf-muted-fill">no dated tasks</text>}
                        {ms.map(t => {
                          const d = (t.end ?? t.start)!
                          const fill = isOverdue(t, today) ? OVER_COLOR : isDone(t) ? '#b0b0b0' : r.p.color
                          return diamond(x(d) + px / 2, cy, MS_SIZE + 3, fill, t.id, e => show(e, taskTip(t, r.p)))
                        })}
                      </g>
                    )
                  }
                  if (r.kind === 'task') {
                    const t = r.t
                    const cy = top + TASK_H / 2
                    const late = isOverdue(t, today)
                    if (t.type === 'milestone') {
                      const d = (t.end ?? t.start)!
                      const fill = late ? OVER_COLOR : isDone(t) ? '#b0b0b0' : r.p.color
                      return <Fragment key={i}>{diamond(x(d) + px / 2, cy, MS_SIZE, fill, t.id, e => show(e, taskTip(t, r.p)))}</Fragment>
                    }
                    const span = barSpan(t.start, t.end)!
                    return (
                      <rect key={i} x={span.x} y={cy - 5} width={span.w} height={10} rx={3}
                        fill={t.statusColor ?? r.p.color} fillOpacity={isDone(t) ? 0.4 : 0.9}
                        stroke={late ? OVER_COLOR : 'none'} strokeWidth={1.5}
                        className="pf-rm__tbar"
                        onMouseMove={e => show(e, taskTip(t, r.p))} onMouseLeave={hide} />
                    )
                  }
                  return null
                })}

                <line x1={todayX} x2={todayX} y1={0} y2={bodyH} className="pf-today" />
              </svg>
            </div>
            {rows.length === 0 && <p className="pf-empty">No projects selected.</p>}
          </div>
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}
