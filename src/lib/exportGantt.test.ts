import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { addDays } from './dates'
import {
  HEADER_H, ROW_H, SECTION_H, TITLE_H, buildGanttSvg, rowsWindow, taskRows,
  type ExportOptions, type ExportRow, type ExportSection,
} from './exportGantt'

const D0 = new Date(2026, 9, 5)
const day = (n: number) => addDays(D0, n)

const task = (id: string, p: Partial<GanttTask> = {}): GanttTask =>
  ({ id, name: id, progress: 0, start: day(0), end: day(2), ...p })

const section = (id: string, p: Partial<ExportSection> = {}): ExportRow => ({
  kind: 'section',
  section: { id, name: id, color: '#2a78d6', taskCount: 1, donePct: 0, milestones: [], ...p },
})

const OPTS: ExportOptions = {
  columns: ['name'], from: day(-7), to: day(14), unit: 'day',
  showToday: false, showArrows: true, today: day(1),
}

const count = (s: string, needle: string) => s.split(needle).length - 1
const ARROW = 'stroke="#1f2937"'

describe('buildGanttSvg', () => {
  it('stacks plain task rows under the header', () => {
    const built = buildGanttSvg(taskRows([task('a'), task('b'), task('c')]), OPTS)
    expect(built.height).toBe(HEADER_H + 3 * ROW_H)
    expect(buildGanttSvg(taskRows([task('a')]), { ...OPTS, title: 'T' }).height).toBe(TITLE_H + HEADER_H + ROW_H)
  })

  it('gives section rows their own height and escapes their names', () => {
    const rows: ExportRow[] = [
      section('A', { name: 'R&D <core>' }), { kind: 'task', task: task('A:1') },
      section('B'), { kind: 'task', task: task('B:1') }, { kind: 'task', task: task('B:2') },
    ]
    const built = buildGanttSvg(rows, OPTS)
    expect(built.height).toBe(HEADER_H + 2 * SECTION_H + 3 * ROW_H)
    expect(built.body).toContain('R&amp;D &lt;core&gt;')
    expect(count(built.body, 'data-section=')).toBe(2)
    expect(built.body).not.toContain('cursor=')
    expect(buildGanttSvg(rows, { ...OPTS, sectionToggles: true }).body).toContain('cursor="pointer"')
  })

  it('marks a repeated header and a project without dates', () => {
    const built = buildGanttSvg([{ ...section('A', { name: 'Web' }), cont: true } as ExportRow], OPTS)
    expect(built.body).toContain('Web (cont.)')
    expect(built.body).toContain('no dated tasks')
    const dated = buildGanttSvg([section('A', { span: { start: day(0), end: day(4) }, donePct: 0.5 })], OPTS)
    expect(dated.body).not.toContain('no dated tasks')
    expect(dated.body).toContain('50%')
  })

  it('draws arrows only between rows that are there', () => {
    const rows: ExportRow[] = [
      section('A'),
      { kind: 'task', task: task('A:1') },
      { kind: 'task', task: task('A:2', { start: day(4), end: day(6), dependencies: ['A:1'] }) },
      section('B'),
      { kind: 'task', task: task('B:2', { start: day(4), end: day(6), dependencies: ['B:1'] }) },
    ]
    expect(count(buildGanttSvg(rows, OPTS).body, ARROW)).toBe(1)
    expect(count(buildGanttSvg(rows, { ...OPTS, showArrows: false }).body, ARROW)).toBe(0)
  })

  it('puts the today line on the given day', () => {
    const rows = taskRows([task('a')])
    expect(buildGanttSvg(rows, { ...OPTS, showToday: true }).body).toContain('stroke-dasharray="4 3"')
    expect(buildGanttSvg(rows, { ...OPTS, showToday: true, today: day(60) }).body).not.toContain('stroke-dasharray')
  })
})

describe('rowsWindow', () => {
  it('covers section spans as well as the tasks', () => {
    const rows: ExportRow[] = [
      section('A', { span: { start: day(-30), end: day(40) } }),
      { kind: 'task', task: task('A:1') },
    ]
    const w = rowsWindow(rows, 'day')
    expect(w.from <= day(-30)).toBe(true)
    expect(w.to >= day(40)).toBe(true)
    const plain = rowsWindow(taskRows([task('a')]), 'day')
    expect(plain.from <= day(0) && plain.from > day(-30)).toBe(true)
  })
})
