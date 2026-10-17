// Read-only multi-project data for the portfolio views: one ClickUp list = one
// project. Fetching only ever issues GET requests; nothing here writes back.

import type { Assignee, GanttTask } from '../types'
import { reviveTask } from '../hooks/useTasks'
import { getAllTasks, type RemoteTask } from './clickup'
import { mapRemoteTask } from './sync'
import { contentWarningIds } from './warnings'
import { DEFAULT_DOD_KEYWORDS } from './settings'
import { addDays, startOfDay } from './dates'

export interface ProjectRef {
  listId: string
  name: string
  folderName?: string
  spaceName?: string
}

// parentName: the parent's name, for context next to generic subtask names
export type PortfolioTask = GanttTask & { projectId: string; warningIds: string[]; parentName?: string }

export interface PortfolioProject {
  ref: ProjectRef
  color: string
  tasks: PortfolioTask[]
  isCurrentBoard: boolean
  fetchedAt?: string
  error?: string
}

export interface CacheEntry {
  fetchedAt?: string
  error?: string
  tasks: PortfolioTask[]
}

export type PortfolioCache = Record<string, CacheEntry>

// Categorical slots in fixed order (validated set, see the dataviz palette).
// A project keeps its slot by its position in the picked list; past eight,
// projects share the neutral "other" color and fold into "Other" in stacks.
export const PROJECT_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#6250d6', '#e34948',
]
export const OTHER_COLOR = '#898781'

export const projectColor = (index: number): string =>
  index < PROJECT_COLORS.length ? PROJECT_COLORS[index] : OTHER_COLOR

export const projectPath = (ref: ProjectRef): string =>
  [ref.spaceName, ref.folderName].filter(Boolean).join(' / ')

/* -------------------------------------------------------------- mapping */

// Cached form: the description checks run while the description is still at
// hand (with the DoD keywords of that moment), then the description is dropped
// to keep localStorage small. Which warnings show is decided later, from the
// settings (warnings.applyWarningSettings).
// Ids are ClickUp ids here, so the remote parent id is the local one too.
export function toPortfolioTask(
  r: RemoteTask, projectId: string, dodKeywords = DEFAULT_DOD_KEYWORDS,
): PortfolioTask {
  const t = mapRemoteTask(r, r.id)
  const ids = contentWarningIds(t, dodKeywords)
  delete t.description
  return { ...t, ...(r.parent ? { parentId: r.parent } : {}), projectId, warningIds: ids }
}

export function fromBoardTask(
  t: GanttTask, projectId: string, dodKeywords = DEFAULT_DOD_KEYWORDS,
): PortfolioTask {
  return { ...t, projectId, warningIds: contentWarningIds(t, dodKeywords) }
}

// Fills parentName from the parent found in the same project
export function withParentNames(tasks: PortfolioTask[]): PortfolioTask[] {
  const names = new Map(tasks.map(t => [t.id, t.name]))
  return tasks.map(t => {
    const parentName = t.parentId ? names.get(t.parentId) : undefined
    return parentName ? { ...t, parentName } : t
  })
}

/* ---------------------------------------------------------------- cache */

export function serializeCache(cache: PortfolioCache): string {
  return JSON.stringify(cache)
}

export function deserializeCache(raw: string): PortfolioCache {
  const parsed = JSON.parse(raw) as Record<string, { fetchedAt?: string; error?: string; tasks?: unknown[] }>
  const out: PortfolioCache = {}
  for (const [listId, e] of Object.entries(parsed)) {
    out[listId] = {
      fetchedAt: e.fetchedAt,
      error: e.error,
      tasks: (e.tasks ?? []).map(t => reviveTask<PortfolioTask>(t as Record<string, unknown>)),
    }
  }
  return out
}

/* ---------------------------------------------------------------- fetch */

export interface FetchResult {
  tasks?: PortfolioTask[]
  listName?: string
  error?: string
}

// Lists are fetched a few at a time; a failing list (including a 429) is
// reported on its own and never aborts the others.
export async function fetchProjects(
  token: string,
  listIds: string[],
  onProgress?: (done: number, total: number) => void,
  dodKeywords = DEFAULT_DOD_KEYWORDS,
  concurrency = 3,
): Promise<Record<string, FetchResult>> {
  const out: Record<string, FetchResult> = {}
  let next = 0
  let done = 0
  onProgress?.(0, listIds.length)
  async function worker() {
    while (next < listIds.length) {
      const listId = listIds[next++]
      try {
        const remote = await getAllTasks(token, listId)
        out[listId] = {
          tasks: withParentNames(remote.map(r => toPortfolioTask(r, listId, dodKeywords))),
          listName: remote.find(r => r.list?.name)?.list?.name,
        }
      } catch (e) {
        out[listId] = { error: e instanceof Error ? e.message : String(e) }
      }
      onProgress?.(++done, listIds.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, listIds.length) }, worker))
  return out
}

/* ----------------------------------------------------------------- demo */

const P = {
  alice: { id: 101, username: 'Alice' },
  bob: { id: 102, username: 'Bob' },
  carol: { id: 103, username: 'Carol' },
  dave: { id: 104, username: 'Dave' },
  eve: { id: 105, username: 'Eve' },
} satisfies Record<string, Assignee>

const DOD = 'Scope agreed.\nDoD: reviewed, merged and deployed.'

interface DemoTask {
  name: string
  s?: number // start, days from today
  e?: number // end, days from today
  ms?: boolean
  st: 'open' | 'custom' | 'done'
  h?: number // estimate in hours
  who?: Assignee[]
  dod?: boolean
  parent?: number // index of the parent task within the project
}

const STATUS: Record<DemoTask['st'], { status: string; color: string }> = {
  open: { status: 'to do', color: '#87909e' },
  custom: { status: 'in progress', color: '#5f55ee' },
  done: { status: 'complete', color: '#008844' },
}

const DEMO: Array<{ ref: ProjectRef; tasks: DemoTask[] }> = [
  {
    ref: { listId: 'demo-web', name: 'Website relaunch', spaceName: 'Marketing', folderName: 'Q4' },
    tasks: [
      { name: 'Design system', s: -30, e: -10, st: 'done', h: 40, who: [P.alice], dod: true },
      { name: 'Landing pages', s: -20, e: -3, st: 'custom', h: 24, who: [P.alice, P.bob], dod: true },
      { name: 'CMS migration', s: -15, e: -1, st: 'custom', h: 16, who: [P.bob] },
      { name: 'Bug bash', s: -2, e: 4, st: 'custom', h: 24, who: [P.bob], dod: true },
      { name: 'Beta launch', e: -2, ms: true, st: 'open' },
      { name: 'SEO audit', s: 2, e: 12, st: 'open', h: 12, who: [P.carol], dod: true },
      { name: 'Content freeze', st: 'open' },
      { name: 'Public launch', e: 21, ms: true, st: 'open' },
    ],
  },
  {
    ref: { listId: 'demo-app', name: 'Mobile app v2', spaceName: 'Product', folderName: 'Apps' },
    tasks: [
      { name: 'Auth rework', s: -12, e: -4, st: 'done', h: 20, who: [P.bob], dod: true },
      { name: 'Offline mode', s: -5, e: 10, st: 'open', h: 30, who: [P.bob], dod: true },
      { name: 'Push notifications', s: 0, e: 14, st: 'custom', h: 24, who: [P.bob, P.eve], dod: true },
      { name: 'Store listing', s: 15, e: 18, st: 'open', h: 6, who: [P.eve], dod: true },
      { name: 'Release candidate', e: 20, ms: true, st: 'open' },
      { name: 'Accessibility pass', s: 8, e: 22, st: 'open', h: 18, who: [P.carol], dod: true },
    ],
  },
  {
    ref: { listId: 'demo-data', name: 'Data platform', spaceName: 'Product', folderName: 'Platform' },
    tasks: [
      { name: 'Warehouse schema', s: 1, e: 20, st: 'custom', h: 60, who: [P.dave], dod: true },
      { name: 'Ingestion jobs', s: 10, e: 40, st: 'open', dod: true },
      { name: 'Batch loader', s: 10, e: 24, st: 'open', h: 40, who: [P.dave], dod: true, parent: 1 },
      { name: 'Streaming loader', s: 22, e: 40, st: 'open', h: 40, who: [P.eve], dod: true, parent: 1 },
      { name: 'Dashboards', s: 35, e: 55, st: 'open', who: [P.carol], dod: true },
      { name: 'Platform GA', e: 60, ms: true, st: 'open' },
    ],
  },
  {
    ref: { listId: 'demo-office', name: 'Office move', spaceName: 'Operations' },
    tasks: [
      { name: 'Pick location', s: -90, e: -60, st: 'done', h: 10, who: [P.eve], dod: true },
      { name: 'Move day', e: -45, ms: true, st: 'done' },
    ],
  },
]

// Synthetic portfolio relative to `today`: one red, one amber, one green and
// one finished project, with Bob over capacity in the current week. Used by
// the "Load demo data" button and by tests.
export function demoProjects(today: Date): PortfolioProject[] {
  const t0 = startOfDay(today)
  return DEMO.map((p, pi) => ({
    ref: p.ref,
    color: projectColor(pi),
    isCurrentBoard: false,
    fetchedAt: t0.toISOString(),
    tasks: withParentNames(p.tasks.map((d, ti) => {
      const start = d.ms ? addDays(t0, d.e!) : d.s !== undefined ? addDays(t0, d.s) : undefined
      const end = d.e !== undefined ? addDays(t0, d.e) : undefined
      const t: GanttTask = {
        id: `${p.ref.listId}-${ti}`,
        name: d.name,
        type: d.ms ? 'milestone' : 'task',
        start,
        end,
        progress: 0,
        status: STATUS[d.st].status,
        statusColor: STATUS[d.st].color,
        statusType: d.st,
        assignees: d.who,
        timeEstimate: d.h ? d.h * 3600000 : undefined,
        description: d.dod ? DOD : d.ms ? DOD : '',
        ...(d.parent !== undefined ? { parentId: `${p.ref.listId}-${d.parent}` } : {}),
      }
      return fromBoardTask(t, p.ref.listId)
    })),
  }))
}
