import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { edgeKey } from './criticalPath'
import type { ExportRow } from './exportGantt'
import type { PortfolioProject, PortfolioTask } from './portfolioData'
import { portfolioCritical, portfolioGanttRows, qualifyId, type PortfolioGanttOptions } from './portfolioGantt'
import { DEFAULT_SETTINGS, type Settings } from './settings'

const TODAY = new Date(2026, 9, 14)
const day = (n: number) => addDays(TODAY, n)

function task(id: string, p: Partial<PortfolioTask> = {}): PortfolioTask {
  return {
    id, name: id, progress: 0, projectId: '', warningIds: [],
    status: 'in progress', statusType: 'custom', start: day(0), end: day(2),
    ...p,
  }
}

function project(listId: string, tasks: PortfolioTask[], name = listId): PortfolioProject {
  return {
    ref: { listId, name }, color: '#2a78d6', isCurrentBoard: false,
    tasks: tasks.map(t => ({ ...t, projectId: listId })),
  }
}

const OPTS: PortfolioGanttOptions = {
  subtasks: true, includeDone: true, includeDateless: true, order: 'list', collapsed: new Set(),
}

const run = (projects: PortfolioProject[], o: Partial<PortfolioGanttOptions> = {}, s: Settings = DEFAULT_SETTINGS) =>
  portfolioGanttRows(projects, TODAY, s, { ...OPTS, ...o })

// Compact picture of the rows: '#' + project id for a header, task ids as is
const shape = (rows: ExportRow[]) =>
  rows.map(r => (r.kind === 'section' ? `#${r.section.id}` : r.task.id))

describe('portfolioGanttRows', () => {
  it('gives every project a section and keeps equal ids apart', () => {
    const { rows } = run([
      project('A', [task('1'), task('2', { dependencies: ['1'] }), task('3', { parentId: '1' })]),
      project('B', [task('1'), task('2', { dependencies: ['1'] })]),
    ])
    expect(shape(rows)).toEqual(['#A', 'A:1', 'A:3', 'A:2', '#B', 'B:1', 'B:2'])
    const byId = new Map(rows.flatMap(r => (r.kind === 'task' ? [[r.task.id, r.task]] : [])))
    expect(byId.get('A:2')!.dependencies).toEqual(['A:1'])
    expect(byId.get('B:2')!.dependencies).toEqual(['B:1'])
    expect(byId.get('A:3')!.parentId).toBe('A:1')
  })

  it('indents subtasks, or shows top level only', () => {
    const p = project('A', [task('p'), task('c', { parentId: 'p' }), task('g', { parentId: 'c' })])
    const on = run([p])
    expect(shape(on.rows)).toEqual(['#A', 'A:p', 'A:c', 'A:g'])
    expect([...on.depths.values()]).toEqual([0, 1, 2])
    expect(shape(run([p], { subtasks: false }).rows)).toEqual(['#A', 'A:p'])
  })

  it('hides done tasks but keeps the parent of an open subtask', () => {
    const p = project('A', [
      task('p', { statusType: 'done' }), task('c', { parentId: 'p' }),
      task('d', { statusType: 'closed' }), task('o'),
    ])
    expect(shape(run([p], { includeDone: false }).rows)).toEqual(['#A', 'A:p', 'A:c', 'A:o'])
    // top level only: the done parent still stands for its open subtree
    expect(shape(run([p], { includeDone: false, subtasks: false }).rows)).toEqual(['#A', 'A:p', 'A:o'])
  })

  it('hides tasks without dates on request', () => {
    const p = project('A', [task('a'), task('u', { start: undefined, end: undefined }), task('m', { start: undefined })])
    expect(shape(run([p], { includeDateless: false }).rows)).toEqual(['#A', 'A:a', 'A:m'])
  })

  it('orders siblings by start date, undated last, ties by due date then list order', () => {
    const p = project('A', [
      task('late', { start: day(9), end: day(10) }),
      task('none', { start: undefined, end: undefined }),
      task('early', { start: day(1), end: day(3) }),
      task('dueOnly', { start: undefined, end: day(5) }),
      task('early2', { start: day(1), end: day(2) }),
      task('early3', { start: day(1), end: day(2) }),
    ])
    expect(shape(run([p], { order: 'start' }).rows))
      .toEqual(['#A', 'A:early2', 'A:early3', 'A:early', 'A:dueOnly', 'A:late', 'A:none'])
    expect(shape(run([p]).rows))
      .toEqual(['#A', 'A:late', 'A:none', 'A:early', 'A:dueOnly', 'A:early2', 'A:early3'])
  })

  it('folds a collapsed project to its header, keeping the count', () => {
    const { rows, depths } = run(
      [project('A', [task('1'), task('2')]), project('B', [task('1')])],
      { collapsed: new Set(['A']) },
    )
    expect(shape(rows)).toEqual(['#A', '#B', 'B:1'])
    const head = rows[0]
    expect(head.kind === 'section' && head.section).toMatchObject({ collapsed: true, taskCount: 2 })
    expect(depths.has('A:1')).toBe(false)
  })

  it('summarizes the whole project in the header', () => {
    const p = project('A', [
      task('a', { start: day(-3), end: day(1), statusType: 'done' }),
      task('b', { start: day(2), end: day(8) }),
      task('m', { type: 'milestone', start: day(6), end: day(6) }),
      task('u', { start: undefined, end: undefined, statusType: 'done' }),
    ], 'Website')
    const head = run([p], { includeDone: false })
      .rows[0]
    expect(head.kind).toBe('section')
    if (head.kind !== 'section') return
    expect(head.section).toMatchObject({
      id: 'A', name: 'Website', color: '#2a78d6', taskCount: 2, donePct: 0.5,
      span: { start: day(-3), end: day(8) }, milestones: [day(6)],
    })
  })

  it('drops backlog tasks when the board hides them', () => {
    const p = project('A', [task('a'), task('b', { status: 'Backlog' })])
    expect(shape(run([p]).rows)).toEqual(['#A', 'A:a', 'A:b'])
    const hide: Settings = {
      ...DEFAULT_SETTINGS,
      backlog: { ...DEFAULT_SETTINGS.backlog, include: { ...DEFAULT_SETTINGS.backlog.include, board: false } },
    }
    expect(shape(run([p], {}, hide).rows)).toEqual(['#A', 'A:a'])
  })
})

describe('portfolioCritical', () => {
  it('finds each project its own chain', () => {
    const c = portfolioCritical([
      project('A', [task('1'), task('2', { dependencies: ['1'] }), task('x', { start: day(0), end: day(1) })]),
      project('B', [task('1'), task('2', { dependencies: ['1'], end: day(30) })]),
    ], DEFAULT_SETTINGS)
    expect([...c.taskIds].sort()).toEqual(['A:1', 'A:2', 'B:1', 'B:2'])
    expect(c.edges).toEqual(new Set([edgeKey('A:1', 'A:2'), edgeKey('B:1', 'B:2')]))
    expect(qualifyId('A', '1')).toBe('A:1')
  })
})
