import { useMemo, useState } from 'react'
import { fmtDate } from '../../lib/dates'
import {
  RAG_LABEL, RAG_ORDER, RISK_KINDS, isDueSoon, projectHealth, riskItems, riskLabel,
  type ProjectHealth, type Rag, type RiskKind,
} from '../../lib/portfolio'
import { withoutBacklog, type Settings } from '../../lib/settings'
import { projectPath, type PortfolioProject, type PortfolioTask } from '../../lib/portfolioData'
import { LOCAL_BOARD_ID } from '../../hooks/usePortfolio'
import { clickupListUrl, clickupTaskUrl } from './shared'

interface Props {
  projects: PortfolioProject[]
  today: Date
  teamId?: string
  onOpenBoard: () => void
  settings: Settings
}

type SortKey = 'name' | 'rag' | 'progress' | 'open' | 'overdue' | 'lateStart' | 'unscheduled'
  | 'unassigned' | 'quality' | 'start' | 'end' | 'milestone'

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean; title?: string }> = [
  { key: 'name', label: 'Project' },
  { key: 'rag', label: 'Health' },
  { key: 'progress', label: 'Done', title: 'Share of tasks in a done / closed status' },
  { key: 'open', label: 'Open', num: true },
  { key: 'overdue', label: 'Overdue', num: true, title: 'Open tasks whose due date has passed' },
  { key: 'lateStart', label: 'Late start', num: true, title: 'Start date passed, still in the initial status' },
  { key: 'unscheduled', label: 'No dates', num: true, title: 'Open tasks missing a start or due date' },
  { key: 'unassigned', label: 'Unassigned', num: true },
  { key: 'quality', label: 'Missing info', num: true },
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
  { key: 'milestone', label: 'Next milestone' },
]

const DEFAULT_KINDS: RiskKind[] = ['overdue', 'late-start', 'due-soon']
const RISK_CAP = 200

export const RAG_ICON: Record<Rag, string> = { red: '✕', amber: '!', green: '✓', done: '✓', empty: '-' }

export function RagPill({ rag, reasons }: { rag: Rag; reasons?: string[] }) {
  return (
    <span className={`pf-rag pf-rag--${rag}`} title={reasons?.join('\n') || undefined}>
      <span className="pf-rag__icon" aria-hidden="true">{RAG_ICON[rag]}</span>
      {RAG_LABEL[rag]}
    </span>
  )
}

function sortValue(p: PortfolioProject, h: ProjectHealth, key: SortKey): number | string {
  switch (key) {
    case 'name': return p.ref.name.toLowerCase()
    case 'rag': return RAG_ORDER[h.rag]
    case 'progress': return h.donePct
    case 'start': return h.start?.getTime() ?? Infinity
    case 'end': return h.end?.getTime() ?? Infinity
    case 'milestone': return h.nextMilestone?.end?.getTime() ?? Infinity
    default: return h[key]
  }
}

// Tooltip of the quality column: the task warnings switched on in Settings
function qualityTitle(s: Settings): string {
  const w = s.warnings
  const parts = [
    w.emptyDescription && 'no description',
    w.missingDod && 'no Definition of Done',
    w.missingPriority && 'no priority',
  ].filter(Boolean)
  return parts.length ? `Open tasks with ${parts.join(' or ')}` : 'All task warnings are off in Settings'
}

export function OverviewTab({ projects, today, teamId, onOpenBoard, settings }: Props) {
  const rows = useMemo(
    () => projects.map(p => ({ p, h: projectHealth(p.tasks, today, settings) })),
    [projects, today, settings],
  )
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rag', dir: 1 })
  const [riskProject, setRiskProject] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Set<RiskKind>>(() => new Set(DEFAULT_KINDS))
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => {
    const out = [...rows]
    out.sort((a, b) => {
      const va = sortValue(a.p, a.h, sort.key)
      const vb = sortValue(b.p, b.h, sort.key)
      const c = va < vb ? -1 : va > vb ? 1 : 0
      // Ties fall back to most overdue first
      return c * sort.dir || b.h.overdue - a.h.overdue
    })
    return out
  }, [rows, sort])

  const kpi = useMemo(() => {
    const k = { open: 0, overdue: 0, overdueMs: 0, due14: 0, unscheduled: 0, red: 0, amber: 0 }
    for (const { p, h } of rows) {
      k.open += h.open
      k.overdue += h.overdue
      k.overdueMs += h.overdueMilestones
      k.unscheduled += h.unscheduled
      if (h.rag === 'red') k.red++
      if (h.rag === 'amber') k.amber++
      k.due14 += withoutBacklog(p.tasks, settings, 'health').filter(t => isDueSoon(t, today, 14)).length
    }
    return k
  }, [rows, today, settings])

  const allRisks = useMemo(
    () => riskItems(projects.map(p => ({ id: p.ref.listId, tasks: p.tasks })), today, settings),
    [projects, today, settings],
  )
  const kindCounts = useMemo(() => {
    const c = Object.fromEntries(RISK_KINDS.map(k => [k, 0])) as Record<RiskKind, number>
    for (const r of allRisks) {
      if (riskProject && r.projectId !== riskProject) continue
      for (const k of r.kinds) c[k]++
    }
    return c
  }, [allRisks, riskProject])
  const risks = useMemo(
    () => allRisks.filter(r =>
      (!riskProject || r.projectId === riskProject) && r.kinds.some(k => kinds.has(k))),
    [allRisks, riskProject, kinds],
  )
  const byId = useMemo(() => new Map(projects.map(p => [p.ref.listId, p])), [projects])

  function toggleSort(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'rag' ? 1 : -1 }))
  }

  function toggleKind(k: RiskKind) {
    setKinds(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const shown = showAll ? risks : risks.slice(0, RISK_CAP)

  return (
    <div className="pf-overview">
      <section className="pf-kpis" aria-label="Portfolio summary">
        <Kpi label="Projects" value={projects.length} />
        <Kpi label="Open tasks" value={kpi.open} />
        <Kpi label="Overdue tasks" value={kpi.overdue} tone={kpi.overdue ? 'bad' : undefined} />
        <Kpi label="Overdue milestones" value={kpi.overdueMs} tone={kpi.overdueMs ? 'bad' : undefined} />
        <Kpi label="Due in 14 days" value={kpi.due14} />
        <Kpi label="Without dates" value={kpi.unscheduled} />
        <Kpi label="Projects at risk" value={kpi.red + kpi.amber}
          sub={kpi.red + kpi.amber ? `${kpi.red} off track, ${kpi.amber} at risk` : 'all on track'}
          tone={kpi.red ? 'bad' : kpi.amber ? 'warn' : undefined} />
      </section>

      <section className="pf-card">
        <h2 className="pf-card__title">Project health</h2>
        <div className="pf-table-wrap">
          <table className="pf-table pf-health">
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th key={c.key} className={c.num ? 'is-num' : undefined}
                    title={c.key === 'quality' ? qualityTitle(settings) : c.title}
                    aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    <button type="button" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
                    </button>
                  </th>
                ))}
                <th aria-label="Links" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, h }) => {
                const id = p.ref.listId
                const active = riskProject === id
                const endLate = h.end && h.end < today && h.open > 0
                return (
                  <tr key={id} className={active ? 'is-active' : undefined}
                    onClick={() => setRiskProject(active ? null : id)}
                    title={active ? 'Show risks of every project' : 'Show only this project in the risk list'}>
                    <td>
                      <div className="pf-proj">
                        <span className="pf-dot" style={{ background: p.color }} />
                        <span className="pf-proj__text">
                          <span className="pf-proj__name">{p.ref.name}</span>
                          {(projectPath(p.ref) || p.isCurrentBoard) && (
                            <span className="pf-proj__path">
                              {p.isCurrentBoard ? 'Current board' : projectPath(p.ref)}
                            </span>
                          )}
                        </span>
                        {p.error && <span className="pf-warn-icon" title={`Last refresh failed: ${p.error}`}>⚠</span>}
                      </div>
                    </td>
                    <td><RagPill rag={h.rag} reasons={h.ragReasons} /></td>
                    <td>
                      <span className="pf-meter" title={`${h.done} of ${h.total} tasks done`}>
                        <span className="pf-meter__track">
                          <span className="pf-meter__fill" style={{ width: `${h.donePct * 100}%` }} />
                        </span>
                        <span className="pf-meter__val">{Math.round(h.donePct * 100)}%</span>
                      </span>
                    </td>
                    <td className="is-num">{h.open}</td>
                    <Count n={h.overdue} bad />
                    <Count n={h.lateStart} warn />
                    <Count n={h.unscheduled} warn />
                    <Count n={h.unassigned} />
                    <Count n={h.quality} />
                    <td className="pf-nowrap">{h.start ? fmtDate(h.start) : '-'}</td>
                    <td className={`pf-nowrap${endLate ? ' pf-late' : ''}`}
                      title={endLate ? 'End date passed with open tasks' : undefined}>
                      {h.end ? fmtDate(h.end) : '-'}
                    </td>
                    <td>
                      {h.nextMilestone
                        ? <span className="pf-ms-cell"><span className="pf-ms-glyph" aria-hidden="true">◆</span>
                            {h.nextMilestone.name} <span className="pf-muted">{fmtDate(h.nextMilestone.end!)}</span></span>
                        : <span className="pf-muted">-</span>}
                    </td>
                    <td className="pf-nowrap" onClick={e => e.stopPropagation()}>
                      {p.isCurrentBoard && (
                        <button type="button" className="pf-link-btn" onClick={onOpenBoard} title="Open in board">Board</button>
                      )}
                      {teamId && p.ref.listId !== LOCAL_BOARD_ID && (
                        <a className="pf-link-btn" href={clickupListUrl(teamId, id)} target="_blank" rel="noreferrer"
                          title="Open list in ClickUp">↗</a>
                      )}
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="pf-empty">No projects selected.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pf-card">
        <div className="pf-card__head">
          <h2 className="pf-card__title">Risks</h2>
          {riskProject && byId.get(riskProject) && (
            <button type="button" className="pf-filter-chip" onClick={() => setRiskProject(null)}>
              <span className="pf-dot" style={{ background: byId.get(riskProject)!.color }} />
              {byId.get(riskProject)!.ref.name}
              <span aria-hidden="true"> ✕</span>
            </button>
          )}
          <div className="pf-spacer" />
          <div className="pf-kind-chips" role="group" aria-label="Risk kinds">
            {RISK_KINDS.map(k => (
              <button key={k} type="button" aria-pressed={kinds.has(k)}
                className={`pf-kind pf-kind--${k}${kinds.has(k) ? ' is-on' : ''}`} onClick={() => toggleKind(k)}>
                {riskLabel(k, settings)} <span className="pf-kind__n">{kindCounts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="pf-table-wrap">
          <table className="pf-table pf-risks">
            <thead>
              <tr>
                <th>Task</th><th>Project</th><th>Risk</th><th>Status</th><th>Assignees</th>
                <th>Start</th><th>Due</th><th className="is-num">Days late</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const p = byId.get(r.projectId)!
                return (
                  <tr key={`${r.projectId}:${r.task.id}`}>
                    <td><TaskName task={r.task} /></td>
                    <td>
                      <span className="pf-proj pf-proj--sm">
                        <span className="pf-dot" style={{ background: p.color }} />{p.ref.name}
                      </span>
                    </td>
                    <td>
                      <span className="pf-kind-tags">
                        {r.kinds.map(k => <span key={k} className={`pf-kind-tag pf-kind--${k}`}>{riskLabel(k, settings)}</span>)}
                      </span>
                    </td>
                    <td><StatusPill task={r.task} /></td>
                    <td className="pf-assignees">{r.task.assignees?.map(a => a.username).join(', ') || <span className="pf-muted">-</span>}</td>
                    <td className="pf-nowrap">{r.task.start ? fmtDate(r.task.start) : '-'}</td>
                    <td className={`pf-nowrap${r.daysLate ? ' pf-late' : ''}`}>{r.task.end ? fmtDate(r.task.end) : '-'}</td>
                    <td className={`is-num${r.daysLate ? ' pf-late' : ''}`}>{r.daysLate || ''}</td>
                  </tr>
                )
              })}
              {risks.length === 0 && (
                <tr><td colSpan={8} className="pf-empty">Nothing matches the selected risk kinds.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {risks.length > RISK_CAP && (
          <button type="button" className="pf-more" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show fewer' : `Show all ${risks.length}`}
          </button>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`pf-kpi${tone ? ` pf-kpi--${tone}` : ''}`}>
      <div className="pf-kpi__label">{label}</div>
      <div className="pf-kpi__value">
        {tone && <span className="pf-kpi__icon" aria-hidden="true">{tone === 'bad' ? '✕' : '!'}</span>}
        {value.toLocaleString()}
      </div>
      {sub && <div className="pf-kpi__sub">{sub}</div>}
    </div>
  )
}

function Count({ n, bad, warn }: { n: number; bad?: boolean; warn?: boolean }) {
  return (
    <td className={`is-num${n && bad ? ' pf-late' : ''}${n && warn ? ' pf-warnnum' : ''}`}>
      {n || <span className="pf-muted">0</span>}
    </td>
  )
}

export function TaskName({ task }: { task: PortfolioTask }) {
  return (
    <span className="pf-task">
      {task.parentName && <span className="pf-task__parent" title={`Subtask of ${task.parentName}`}>{task.parentName} ›</span>}
      {task.type === 'milestone' && <span className="pf-ms-glyph" title="Milestone">◆</span>}
      {task.clickupId
        ? <a href={clickupTaskUrl(task.clickupId)} target="_blank" rel="noreferrer" title="Open in ClickUp">{task.name}</a>
        : <span>{task.name}</span>}
    </span>
  )
}

export function StatusPill({ task }: { task: PortfolioTask }) {
  if (!task.status) return <span className="pf-muted">-</span>
  return (
    <span className="pf-status">
      <span className="pf-dot pf-dot--sm" style={{ background: task.statusColor ?? '#b0b0b0' }} />
      {task.status}
    </span>
  )
}
