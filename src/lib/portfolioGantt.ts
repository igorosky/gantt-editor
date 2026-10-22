// Rows for the portfolio gantt: one section per project, its tasks below it,
// drawn by the export renderer (exportGantt.buildGanttSvg). Pure. Task ids are
// qualified with the project id, since ids are only unique within one list.

import type { ExportRow } from './exportGantt'
import type { PortfolioProject, PortfolioTask } from './portfolioData'
import { computeCriticalPath, EMPTY_CRITICAL, type CriticalPath } from './criticalPath'
import { isDone, projectHealth } from './portfolio'
import { withoutBacklog, type Settings } from './settings'
import { flattenTree, sortByDate } from './tree'

export type GanttOrder = 'start' | 'list'

export interface PortfolioGanttOptions {
  subtasks: boolean        // off: top-level tasks only
  includeDone: boolean
  includeDateless: boolean
  order: GanttOrder        // siblings by start date, or in list order
  collapsed: ReadonlySet<string> // project ids shown as their header only
}

export const qualifyId = (projectId: string, id: string): string => `${projectId}:${id}`

// A project's tasks as the board would see them: backlog dropped (same rule
// as the board gantt), ids, parents and predecessors qualified
function projectTasks(p: PortfolioProject, settings: Settings): PortfolioTask[] {
  const q = (id: string) => qualifyId(p.ref.listId, id)
  return withoutBacklog(p.tasks, settings, 'board').map(t => ({
    ...t,
    id: q(t.id),
    ...(t.parentId ? { parentId: q(t.parentId) } : {}),
    ...(t.dependencies ? { dependencies: t.dependencies.map(q) } : {}),
  }))
}

export function portfolioGanttRows(
  projects: PortfolioProject[], today: Date, settings: Settings, opts: PortfolioGanttOptions,
): { rows: ExportRow[]; depths: Map<string, number> } {
  const rows: ExportRow[] = []
  const depths = new Map<string, number>()

  for (const p of projects) {
    const tasks = projectTasks(p, settings)
    // Array order is sibling order, so sorting the array sorts every level
    const ordered = opts.order === 'start' ? sortByDate(tasks, 'start') : tasks
    const kept = new Set<string>()
    for (const t of tasks) {
      if (!opts.includeDone && isDone(t)) continue
      if (!opts.includeDateless && !t.start && !t.end) continue
      kept.add(t.id)
    }
    // Ancestors of a kept task stay (as on the filtered board). Without
    // subtasks a top-level task shows when anything in its subtree is kept.
    const flat = flattenTree(ordered, { include: kept })
    const shown = opts.subtasks ? flat : flat.filter(r => r.depth === 0)

    const h = projectHealth(p.tasks, today, settings)
    const milestones = withoutBacklog(p.tasks, settings, 'health')
      .filter(t => t.type === 'milestone' && (t.end ?? t.start))
      .map(t => (t.end ?? t.start)!)
    const collapsed = opts.collapsed.has(p.ref.listId)
    rows.push({
      kind: 'section',
      section: {
        id: p.ref.listId,
        name: p.ref.name,
        color: p.color,
        taskCount: shown.length,
        span: h.start && h.end ? { start: h.start, end: h.end } : undefined,
        donePct: h.donePct,
        milestones,
        collapsed,
      },
    })
    if (collapsed) continue
    for (const r of shown) {
      rows.push({ kind: 'task', task: r.task })
      depths.set(r.task.id, r.depth)
    }
  }
  return { rows, depths }
}

// Each project's own longest chain (projects never link to each other), over
// the whole project rather than the shown rows, like the board's default
export function portfolioCritical(projects: PortfolioProject[], settings: Settings): CriticalPath {
  const taskIds = new Set<string>()
  const edges = new Set<string>()
  for (const p of projects) {
    const c = computeCriticalPath(projectTasks(p, settings))
    for (const id of c.taskIds) taskIds.add(id)
    for (const e of c.edges) edges.add(e)
  }
  return taskIds.size ? { taskIds, edges } : EMPTY_CRITICAL
}
