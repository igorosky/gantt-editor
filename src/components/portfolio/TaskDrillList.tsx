import { fmtDate } from '../../lib/dates'
import type { PortfolioProject, PortfolioTask } from '../../lib/portfolioData'
import { isOverdue } from '../../lib/portfolio'
import type { WorkloadMetric } from '../../lib/workload'
import { StatusPill, TaskName } from './OverviewTab'
import { fmtValue } from './shared'

export interface DrillRow {
  task: PortfolioTask
  value: number
}

interface Props {
  title: string
  rows: DrillRow[]
  metric: WorkloadMetric
  projects: Map<string, PortfolioProject>
  today: Date
  onClose: () => void
}

// Tasks behind one bar / heatmap cell
export function TaskDrillList({ title, rows, metric, projects, today, onClose }: Props) {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.task.name.localeCompare(b.task.name))
  return (
    <section className="pf-card pf-drill">
      <div className="pf-card__head">
        <h3 className="pf-card__title">{title}</h3>
        <span className="pf-muted">{rows.length} task{rows.length === 1 ? '' : 's'}</span>
        <div className="pf-spacer" />
        <button type="button" className="pf-close" onClick={onClose} aria-label="Close task list">✕</button>
      </div>
      <div className="pf-table-wrap">
        <table className="pf-table">
          <thead>
            <tr>
              <th>Task</th><th>Project</th><th>Status</th><th>Assignees</th><th>Start</th><th>Due</th>
              {metric === 'hours' && <th className="is-num">In period</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ task, value }) => {
              const p = projects.get(task.projectId)
              const late = isOverdue(task, today)
              return (
                <tr key={`${task.projectId}:${task.id}`}>
                  <td><TaskName task={task} /></td>
                  <td>
                    {p && <span className="pf-proj pf-proj--sm"><span className="pf-dot" style={{ background: p.color }} />{p.ref.name}</span>}
                  </td>
                  <td><StatusPill task={task} /></td>
                  <td className="pf-assignees">{task.assignees?.map(a => a.username).join(', ') || <span className="pf-muted">-</span>}</td>
                  <td className="pf-nowrap">{task.start ? fmtDate(task.start) : '-'}</td>
                  <td className={`pf-nowrap${late ? ' pf-late' : ''}`}>{task.end ? fmtDate(task.end) : '-'}</td>
                  {metric === 'hours' && <td className="is-num">{fmtValue('hours', value)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
