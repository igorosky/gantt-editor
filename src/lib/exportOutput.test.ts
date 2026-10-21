import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { addDays } from './dates'
import { ROW_H, SECTION_H, type ExportOptions, type ExportRow } from './exportGantt'
import { buildPages, pageCount, paginateRows, paperGeom } from './exportOutput'

const D0 = new Date(2026, 9, 5)

const t = (id: string): ExportRow => ({
  kind: 'task', task: { id, name: id, progress: 0, start: D0, end: addDays(D0, 2) } as GanttTask,
})
const s = (id: string): ExportRow => ({
  kind: 'section', section: { id, name: `Project ${id}`, color: '#2a78d6', taskCount: 0, donePct: 0, milestones: [] },
})

// 'S1' for a header, 'S1+' for a repeated one, task ids as is
const shape = (pages: ExportRow[][]) => pages.map(p => p.map(r =>
  r.kind === 'section' ? `${r.section.id}${r.cont ? '+' : ''}` : r.task.id))

describe('paginateRows', () => {
  it('fills pages with plain rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => t(`t${i}`))
    expect(shape(paginateRows(rows, 4 * ROW_H)).map(p => p.length)).toEqual([4, 4, 2])
  })

  it('never ends a page on a header', () => {
    const rows = [s('S1'), t('a'), t('b'), s('S2'), t('c'), t('d')]
    expect(shape(paginateRows(rows, 2 * SECTION_H + 2 * ROW_H)))
      .toEqual([['S1', 'a', 'b'], ['S2', 'c', 'd']])
  })

  it('repeats the header on a page that starts mid-section', () => {
    const rows = [s('S1'), t('a'), t('b'), t('c'), t('d'), t('e')]
    expect(shape(paginateRows(rows, SECTION_H + 2 * ROW_H)))
      .toEqual([['S1', 'a', 'b'], ['S1+', 'c', 'd'], ['S1+', 'e']])
  })

  it('starts every section on a new page when asked', () => {
    const rows = [s('S1'), t('a'), s('S2'), t('b'), s('S3')]
    expect(shape(paginateRows(rows, 1000, true))).toEqual([['S1', 'a'], ['S2', 'b'], ['S3']])
    expect(shape(paginateRows(rows, 1000))).toEqual([['S1', 'a', 'S2', 'b', 'S3']])
  })

  it('keeps folded sections (headers only) together', () => {
    expect(shape(paginateRows([s('S1'), s('S2'), s('S3'), t('a')], 1000))).toEqual([['S1', 'S2', 'S3', 'a']])
  })

  it('gives a row taller than the page a page of its own', () => {
    expect(shape(paginateRows([s('S1'), t('a')], 10))).toEqual([['S1'], ['a']])
  })
})

describe('buildPages', () => {
  const opts: ExportOptions = {
    columns: ['name'], from: addDays(D0, -2), to: addDays(D0, 10), unit: 'day',
    showToday: false, showArrows: false,
  }
  const geom = paperGeom('a4', true)
  const rows = [s('A'), t('a1'), t('a2'), s('B'), t('b1')]

  it('prints one scaled sheet, or one per project', () => {
    expect(pageCount(rows, opts, geom, false)).toBe(1)
    expect(pageCount(rows, opts, geom, false, true)).toBe(2)
    const pages = buildPages(rows, opts, geom, false, true)
    expect(pages).toHaveLength(2)
    expect(pages[0].label).toMatch(/^Project A {2}·/)
    expect(pages[1].label).toMatch(/^Project B {2}·/)
  })

  it('labels a plain task export by its task range when paginated', () => {
    const plain = [t('a'), t('b')]
    expect(buildPages(plain, opts, geom, true)[0].label).toMatch(/^Tasks 1–2 of 2/)
    expect(buildPages(plain, opts, geom, false)[0].label).not.toMatch(/Tasks/)
  })
})
