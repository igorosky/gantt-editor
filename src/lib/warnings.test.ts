import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { applyWarningSettings, contentWarningIds, getTaskWarnings } from './warnings'

const task = (p: Partial<GanttTask> = {}): GanttTask => ({ id: 'x', name: 'x', progress: 0, ...p })

const withWarnings = (w: Partial<Settings['warnings']>, include = DEFAULT_SETTINGS.backlog.include): Settings => ({
  ...DEFAULT_SETTINGS,
  warnings: { ...DEFAULT_SETTINGS.warnings, ...w },
  backlog: { ...DEFAULT_SETTINGS.backlog, include },
})

const ids = (t: GanttTask, s?: Settings) => getTaskWarnings(t, s).map(w => w.id)

describe('task warnings', () => {
  it('keeps the old behaviour by default', () => {
    expect(ids(task())).toEqual(['empty-description'])
    expect(ids(task({ description: 'Build it' }))).toEqual(['missing-dod'])
    expect(ids(task({ description: 'DoD: shipped' }))).toEqual([]) // no priority warning by default
  })

  it('switches each warning on and off', () => {
    expect(ids(task({ description: 'Build it' }), withWarnings({ missingDod: false }))).toEqual([])
    expect(ids(task(), withWarnings({ emptyDescription: false, missingDod: false }))).toEqual([])
    const prio = withWarnings({ missingPriority: true })
    expect(ids(task({ description: 'DoD: ok' }), prio)).toEqual(['missing-priority'])
    expect(ids(task({ description: 'DoD: ok', priority: 3 }), prio)).toEqual([])
  })

  it('reports an empty description as a missing DoD when only that warning is on', () => {
    expect(ids(task(), withWarnings({ emptyDescription: false }))).toEqual(['missing-dod'])
  })

  it('uses the configured DoD keywords', () => {
    const s = withWarnings({ dodKeywords: ['Kryteria ukończenia'] })
    expect(ids(task({ description: 'Kryteria ukończenia: działa' }), s)).toEqual([])
    expect(ids(task({ description: 'DoD: shipped' }), s)).toEqual(['missing-dod'])
  })

  it('skips backlog tasks when backlog is excluded from warnings', () => {
    const s = withWarnings({ missingPriority: true }, { ...DEFAULT_SETTINGS.backlog.include, warnings: false })
    expect(ids(task({ status: 'Backlog' }), s)).toEqual([])
    expect(ids(task({ status: 'to do' }), s)).toEqual(['empty-description', 'missing-priority'])
  })

  it('applies the settings to precomputed content ids', () => {
    expect(contentWarningIds(task(), ['DoD'])).toEqual(['empty-description'])
    const t = task({ description: undefined })
    expect(applyWarningSettings(['missing-dod'], t).map(w => w.id)).toEqual(['missing-dod'])
    expect(applyWarningSettings([], t).map(w => w.id)).toEqual([])
  })
})
