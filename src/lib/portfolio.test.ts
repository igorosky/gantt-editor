import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { addDays } from './dates'
import {
  daysLate, isDone, isDueSoon, isLateStart, isOverdue, projectHealth, riskItems, riskLabel,
  type HealthTask,
} from './portfolio'
import { demoProjects } from './portfolioData'
import { DEFAULT_SETTINGS, type Settings } from './settings'

const settings = (p: { rules?: Partial<Settings['rules']>; include?: Partial<Settings['backlog']['include']>; warnings?: Partial<Settings['warnings']> }): Settings => ({
  ...DEFAULT_SETTINGS,
  warnings: { ...DEFAULT_SETTINGS.warnings, ...p.warnings },
  rules: { ...DEFAULT_SETTINGS.rules, ...p.rules },
  backlog: { ...DEFAULT_SETTINGS.backlog, include: { ...DEFAULT_SETTINGS.backlog.include, ...p.include } },
})

const TODAY = new Date(2026, 9, 14, 13, 30) // mid-day on purpose
const day = (n: number) => addDays(TODAY, n)

let seq = 0
function task(p: Partial<HealthTask> = {}): HealthTask {
  return {
    id: `t${seq++}`, name: 'x', progress: 0,
    statusType: 'custom', status: 'in progress',
    assignees: [{ id: 1, username: 'A' }],
    ...p,
  }
}

describe('task state', () => {
  it('trusts the ClickUp status type, falls back to the name', () => {
    expect(isDone(task({ statusType: 'done' }))).toBe(true)
    expect(isDone(task({ statusType: 'closed' }))).toBe(true)
    expect(isDone(task({ statusType: 'custom', status: 'Done' }))).toBe(false)
    expect(isDone(task({ statusType: undefined, status: 'Complete' }))).toBe(true)
    expect(isDone(task({ statusType: undefined, status: 'in review' }))).toBe(false)
    expect(isDone(task({ statusType: undefined, status: undefined }))).toBe(false)
  })

  it('flags overdue only for open tasks due before today', () => {
    expect(isOverdue(task({ end: day(-1) }), TODAY)).toBe(true)
    expect(isOverdue(task({ end: day(0) }), TODAY)).toBe(false)
    expect(isOverdue(task({ end: day(-1), statusType: 'done' }), TODAY)).toBe(false)
    expect(isOverdue(task({ start: day(-9) }), TODAY)).toBe(false)
    expect(daysLate(task({ end: day(-3) }), TODAY)).toBe(3)
    expect(daysLate(task({ end: day(2) }), TODAY)).toBe(0)
  })

  it('flags a late start while the task sits in its initial status', () => {
    expect(isLateStart(task({ start: day(-1), statusType: 'open' }), TODAY)).toBe(true)
    expect(isLateStart(task({ start: day(-1), statusType: 'custom' }), TODAY)).toBe(false)
    expect(isLateStart(task({ start: day(0), statusType: 'open' }), TODAY)).toBe(false)
    expect(isLateStart(task({ start: day(-1), statusType: undefined, status: undefined }), TODAY)).toBe(true)
    expect(isLateStart(task({ start: day(-1), statusType: undefined, status: 'To Do' }), TODAY)).toBe(true)
    expect(isLateStart(task({ type: 'milestone', start: day(-1), end: day(-1), statusType: 'open' }), TODAY)).toBe(false)
  })

  it('due soon covers today through the next 7 days', () => {
    expect(isDueSoon(task({ end: day(0) }), TODAY)).toBe(true)
    expect(isDueSoon(task({ end: day(7) }), TODAY)).toBe(true)
    expect(isDueSoon(task({ end: day(8) }), TODAY)).toBe(false)
    expect(isDueSoon(task({ end: day(-1) }), TODAY)).toBe(false)
  })
})

describe('projectHealth', () => {
  const dated = (p: Partial<HealthTask> = {}) => task({ start: day(1), end: day(10), ...p })

  it('is red at 20% of open tasks overdue, amber below', () => {
    const five = [dated({ end: day(-1), start: day(-5) }), dated(), dated(), dated(), dated()]
    expect(projectHealth(five, TODAY).rag).toBe('red')
    const ten = [dated({ end: day(-1), start: day(-5) }), ...Array.from({ length: 9 }, () => dated())]
    const h = projectHealth(ten, TODAY)
    expect(h.rag).toBe('amber')
    expect(h.overdue).toBe(1)
  })

  it('is red on an overdue milestone or a passed end date', () => {
    const ms = task({ type: 'milestone', start: day(-1), end: day(-1), assignees: undefined })
    const withMs = [ms, ...Array.from({ length: 9 }, () => dated())]
    expect(projectHealth(withMs, TODAY).rag).toBe('red')
    expect(projectHealth(withMs, TODAY).ragReasons[0]).toMatch(/milestone/)

    const ended = [dated({ start: day(-9), end: day(-5), statusType: 'done' }), task({ statusType: 'open' })]
    expect(projectHealth(ended, TODAY).rag).toBe('red')
  })

  it('is amber at 25% unscheduled', () => {
    const tasks = [task(), dated(), dated(), dated()]
    expect(projectHealth(tasks, TODAY).rag).toBe('amber')
    expect(projectHealth([task(), dated(), dated(), dated(), dated()], TODAY).rag).toBe('green')
  })

  it('takes its thresholds from the settings', () => {
    const ten = [dated({ end: day(-1), start: day(-5) }), ...Array.from({ length: 9 }, () => dated())]
    expect(projectHealth(ten, TODAY, settings({ rules: { redOverdueShare: 0.1 } })).rag).toBe('red')
    const unscheduled = [task(), dated(), dated(), dated()]
    expect(projectHealth(unscheduled, TODAY, settings({ rules: { amberUnscheduledShare: 0.3 } })).rag).toBe('green')
    const soon = [dated({ start: day(1), end: day(10) })]
    expect(projectHealth(soon, TODAY).dueSoon).toBe(0)
    expect(projectHealth(soon, TODAY, settings({ rules: { dueSoonDays: 10 } })).dueSoon).toBe(1)
    expect(riskLabel('due-soon', settings({ rules: { dueSoonDays: 14 } }))).toBe('Due in 14d')
  })

  it('leaves backlog tasks out of health only when told to', () => {
    const tasks = [
      dated(),
      task({ status: 'backlog', statusType: 'custom' }), // undated backlog task
    ]
    expect(projectHealth(tasks, TODAY).rag).toBe('amber')
    const h = projectHealth(tasks, TODAY, settings({ include: { health: false } }))
    expect(h).toMatchObject({ rag: 'green', total: 1, unscheduled: 0 })
    expect(riskItems([{ id: 'p', tasks }], TODAY).map(r => r.task.status)).toEqual(['backlog'])
    expect(riskItems([{ id: 'p', tasks }], TODAY, settings({ include: { health: false } }))).toEqual([])
  })

  it('counts quality warnings from the settings', () => {
    const tasks = [dated({ warningIds: ['missing-dod'] }), dated({ warningIds: [], priority: 2 })]
    expect(projectHealth(tasks, TODAY).quality).toBe(1)
    expect(projectHealth(tasks, TODAY, settings({ warnings: { missingDod: false } })).quality).toBe(0)
    expect(projectHealth(tasks, TODAY, settings({ warnings: { missingPriority: true } })).quality).toBe(1)
    expect(projectHealth(tasks, TODAY, settings({ warnings: { missingDod: false, missingPriority: true } })).quality).toBe(1)
    // Tags stay on cached tasks, so the required tag check needs no precomputed id
    const tagged = [dated({ warningIds: [], tags: [{ name: 'Backend' }] }), dated({ warningIds: [] })]
    const req = settings({ warnings: { missingTag: true, requiredTags: ['backend'] } })
    expect(projectHealth(tagged, TODAY).quality).toBe(0)
    expect(projectHealth(tagged, TODAY, req).quality).toBe(1)
  })

  it('reports done and empty projects', () => {
    expect(projectHealth([dated({ statusType: 'done' })], TODAY).rag).toBe('done')
    expect(projectHealth([], TODAY).rag).toBe('empty')
  })

  it('scores the demo portfolio', () => {
    const [web, app, data, office] = demoProjects(TODAY).map(p => projectHealth(p.tasks, TODAY))
    expect([web.rag, app.rag, data.rag, office.rag]).toEqual(['red', 'amber', 'green', 'done'])
    expect(web).toMatchObject({
      total: 8, done: 1, open: 7, overdue: 3, overdueMilestones: 1,
      lateStart: 0, dueSoon: 1, unscheduled: 1, unassigned: 1, quality: 2,
    })
    expect(web.nextMilestone?.name).toBe('Public launch')
    expect(app.lateStart).toBe(1)
    // The parent of two assigned subtasks is neither unassigned nor a workload double count
    expect(data).toMatchObject({ total: 6, unassigned: 0 })
  })

  it('does not flag a task with subtasks as undated or unassigned', () => {
    const tasks = [
      task({ id: 'p', assignees: [] }),
      task({ id: 'c', parentId: 'p', start: day(1), end: day(3) }),
      task({ id: 'c2', parentId: 'p', assignees: [] }),
    ]
    const h = projectHealth(tasks, TODAY)
    expect(h).toMatchObject({ unscheduled: 1, unassigned: 1 })
    const rows = riskItems([{ id: 'x', tasks }], TODAY)
    expect(rows.map(r => [r.task.id, r.kinds])).toEqual([
      ['c', ['due-soon']],
      ['c2', ['undated', 'unassigned']],
    ])
  })
})

describe('riskItems', () => {
  it('sorts worst kind first, then most days late', () => {
    const tasks: GanttTask[] = [
      task({ name: 'soon', start: day(1), end: day(3) }),
      task({ name: 'late1', start: day(-9), end: day(-1) }),
      task({ name: 'late5', start: day(-9), end: day(-5) }),
      task({ name: 'fine', start: day(1), end: day(30) }),
      task({ name: 'closed', start: day(-9), end: day(-5), statusType: 'done' }),
      task({ name: 'undated' }),
    ]
    const rows = riskItems([{ id: 'p', tasks }], TODAY)
    expect(rows.map(r => r.task.name)).toEqual(['late5', 'late1', 'soon', 'undated'])
    expect(rows[0]).toMatchObject({ projectId: 'p', kinds: ['overdue'], daysLate: 5 })
  })
})
