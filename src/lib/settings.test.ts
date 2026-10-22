import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import {
  DEFAULT_SETTINGS, dodPattern, isBacklog, normalizeSettings, weekOrder, withoutBacklog, workdayLabel,
  type Settings,
} from './settings'

const task = (p: Partial<GanttTask> = {}): GanttTask => ({ id: 'x', name: 'x', progress: 0, ...p })

const withBacklog = (include: Partial<Settings['backlog']['include']>, statuses = ['backlog']): Settings => ({
  ...DEFAULT_SETTINGS,
  backlog: { statuses, include: { ...DEFAULT_SETTINGS.backlog.include, ...include } },
})

describe('normalizeSettings', () => {
  it('falls back to the defaults for missing or malformed values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ warnings: { missingDod: 'yes' }, calendar: { weekStart: 9 } }))
      .toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and fills in the rest', () => {
    const s = normalizeSettings({
      warnings: { missingPriority: true, dodKeywords: [' DoD ', 'dod', 'Kryteria ukończenia', 3] },
      calendar: { weekStart: 0, workdays: [4, 0, 1, 2, 3, 3, 8] },
      backlog: { include: { board: false } },
    })
    expect(s.warnings).toEqual({
      emptyDescription: true, missingDod: true, missingPriority: true,
      dodKeywords: ['DoD', 'Kryteria ukończenia'],
    })
    expect(s.calendar).toEqual({ weekStart: 0, workdays: [0, 1, 2, 3, 4] })
    expect(s.backlog).toEqual({
      statuses: ['backlog'],
      include: { board: false, warnings: true, health: true, workload: true },
    })
  })

  it('never leaves the DoD keywords or the working days empty', () => {
    const s = normalizeSettings({ warnings: { dodKeywords: ['  '] }, calendar: { workdays: [] } })
    expect(s.warnings.dodKeywords).toEqual(DEFAULT_SETTINGS.warnings.dodKeywords)
    expect(s.calendar.workdays).toEqual([1, 2, 3, 4, 5])
  })

  it('accepts an empty backlog status list', () => {
    expect(normalizeSettings({ backlog: { statuses: [] } }).backlog.statuses).toEqual([])
  })

  it('clamps the portfolio rules', () => {
    const s = normalizeSettings({ rules: { dueSoonDays: 3.6, redOverdueShare: 4, amberUnscheduledShare: -1 } })
    expect(s.rules).toEqual({ dueSoonDays: 4, redOverdueShare: 1, amberUnscheduledShare: 0 })
    expect(normalizeSettings({ rules: { dueSoonDays: NaN } }).rules.dueSoonDays).toBe(7)
  })

  it('reads the milestone style, with a blank tag or unknown kind taking the default', () => {
    expect(normalizeSettings({ milestones: { as: 'tag', tag: ' Kamień ' } }).milestones)
      .toEqual({ as: 'tag', tag: 'Kamień' })
    expect(normalizeSettings({ milestones: { as: 'other', tag: '  ' } }).milestones)
      .toEqual({ as: 'type', tag: 'milestone' })
  })
})

describe('backlog', () => {
  it('matches the status name ignoring case and padding', () => {
    expect(isBacklog(task({ status: ' BackLog ' }), DEFAULT_SETTINGS)).toBe(true)
    expect(isBacklog(task({ status: 'backlog review' }), DEFAULT_SETTINGS)).toBe(false)
    expect(isBacklog(task(), DEFAULT_SETTINGS)).toBe(false)
  })

  it('leaves backlog tasks out only where they are excluded', () => {
    const tasks = [task({ id: 'a', status: 'backlog' }), task({ id: 'b', status: 'to do' })]
    const s = withBacklog({ workload: false })
    expect(withoutBacklog(tasks, s, 'board')).toBe(tasks)
    expect(withoutBacklog(tasks, s, 'workload').map(t => t.id)).toEqual(['b'])
    expect(withoutBacklog(tasks, withBacklog({ workload: false }, []), 'workload')).toBe(tasks)
  })
})

describe('dodPattern', () => {
  it('matches whole phrases, case-insensitively', () => {
    const re = dodPattern(['DoD', 'Definition of Done'])
    expect(re.test('dod: shipped')).toBe(true)
    expect(re.test('Definition  of\ndone - tests green')).toBe(true)
    expect(re.test('dodo bird')).toBe(false)
    expect(re.test('no criteria')).toBe(false)
  })

  it('handles Polish letters at the phrase edges and regex characters', () => {
    expect(dodPattern(['Kryteria ukończenia']).test('Kryteria ukończenia: działa')).toBe(true)
    expect(dodPattern(['ukończenia']).test('nieukończenia')).toBe(false)
    expect(dodPattern(['Done (v2)']).test('see Done (v2) below')).toBe(true)
  })
})

describe('weekdays', () => {
  it('orders the week from its first day', () => {
    expect(weekOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(weekOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('labels runs, wrapped runs and gaps', () => {
    expect(workdayLabel([1, 2, 3, 4, 5])).toBe('Mon-Fri')
    expect(workdayLabel([0, 1, 2, 3, 4])).toBe('Sun-Thu')
    expect(workdayLabel([6, 0, 1])).toBe('Sat-Mon')
    expect(workdayLabel([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(workdayLabel([2])).toBe('Tue')
    expect(workdayLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day')
  })
})
