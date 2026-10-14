// Standalone SVG renderer for exporting the chart to PNG / PDF.
//
// This does NOT read the live frappe-gantt DOM: that chart is a mix of SVG bars
// and absolutely positioned HTML header divs, and it is clipped by its scroll
// container. Instead the whole picture is redrawn from the task array into one
// self-contained <svg> string (no external CSS, no external fonts), which can be
// rasterized through an <img> or handed to the print pipeline.

import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { edgeKey } from './criticalPath'
import {
  MONTHS, addDays, autoUnit, daysBetween, fmtDate, startOfDay, startOfMonth,
  startOfWeek, unitStarts, type TimeUnit,
} from './dates'

// Re-exported so existing importers keep working
export { addDays, autoUnit, daysBetween, startOfDay, unitStarts }
export type { TimeUnit }

export type LhsColumn =
  | 'name' | 'start' | 'end' | 'duration' | 'status'
  | 'assignees' | 'priority' | 'tags' | 'id'

export interface ExportOptions {
  columns: LhsColumn[]  // 'name' is always present and drawn first
  from: Date            // inclusive window start
  to: Date              // inclusive window end
  unit: TimeUnit
  title?: string
  showToday: boolean
  showArrows: boolean
  // Critical path, precomputed by the caller. Empty / absent means no
  // highlighting; the sets must be computed over the whole task selection
  // before pagination, since each page only ever sees a slice of the rows.
  criticalIds?: ReadonlySet<string>
  criticalEdges?: ReadonlySet<string>
}

export interface BuiltSvg {
  body: string
  width: number
  height: number
}

/* ---------------------------------------------------------------- geometry */

export const ROW_H = 26
export const HEADER_H = 40 // upper band 20 + lower band 20
export const TITLE_H = 30
const BAR_H = 14
const MS_SIDE = 12
const MS_HALF = (MS_SIDE * Math.SQRT2) / 2 // half-width of the rotated square
const CELL_PAD = 8
const CURVE = 5
const ARROW_PAD = ROW_H - BAR_H

const PX_PER_DAY: Record<TimeUnit, number> = {
  day: 26,
  week: 44 / 7,
  month: 60 / 30.44,
}

export const COLUMNS: Record<LhsColumn, { label: string; width: number }> = {
  name: { label: 'Task', width: 220 },
  start: { label: 'Start', width: 82 },
  end: { label: 'End', width: 82 },
  duration: { label: 'Days', width: 52 },
  status: { label: 'Status', width: 100 },
  assignees: { label: 'Assignees', width: 130 },
  priority: { label: 'Priority', width: 66 },
  tags: { label: 'Tags', width: 120 },
  id: { label: 'ID', width: 76 },
}

export const COLUMN_ORDER: LhsColumn[] =
  ['name', 'start', 'end', 'duration', 'status', 'priority', 'assignees', 'tags', 'id']

// Print palette. Hardcoded literals rather than CSS custom properties: once the
// SVG is detached from the document (or loaded through <img>) var() cannot
// resolve. Values mirror src/App.css :root and frappe-gantt styles/themes.css.
const C = {
  bg: '#ffffff',
  rowAlt: '#fafafa',
  border: '#e8e8e8',
  borderStrong: '#d0d0d0',
  headerBg: '#f6f7fb',
  tick: '#f0f0f0',
  tickThick: '#e0e0e0',
  weekend: '#f7f7f7',
  text: '#1a1a1a',
  textMid: '#444444',
  textMuted: '#888888',
  bar: '#7c85f5',
  milestone: '#f5a623',
  arrow: '#1f2937',
  today: '#37352f',
  critical: '#e5484d', // mirrors --critical
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low',
}

/* -------------------------------------------------------------- layout math */

export function pxPerDay(unit: TimeUnit): number {
  return PX_PER_DAY[unit]
}

export function chartWidth(from: Date, to: Date, unit: TimeUnit): number {
  return Math.max(1, daysBetween(from, to) + 1) * PX_PER_DAY[unit]
}

export function lhsWidth(columns: LhsColumn[]): number {
  return columns.reduce((sum, c) => sum + COLUMNS[c].width, 0)
}

export function headerBlockHeight(opts: { title?: string }): number {
  return HEADER_H + (opts.title ? TITLE_H : 0)
}

function monthStarts(from: Date, to: Date): Date[] {
  const out: Date[] = []
  let cur = startOfMonth(from)
  const last = startOfDay(to)
  while (cur <= last) {
    out.push(cur)
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return out
}

function yearStarts(from: Date, to: Date): Date[] {
  const out: Date[] = []
  let cur = new Date(from.getFullYear(), 0, 1)
  const last = startOfDay(to)
  while (cur <= last) {
    out.push(cur)
    cur = new Date(cur.getFullYear() + 1, 0, 1)
  }
  return out
}

// Window covering every dated task, padded out to whole units. Falls back to
// today +/- 2 weeks when nothing in the selection carries a date.
export function fitWindow(tasks: GanttTask[], unit: TimeUnit | 'auto' = 'auto'): { from: Date; to: Date } {
  let min: Date | null = null
  let max: Date | null = null
  for (const t of tasks) {
    const s = t.start ?? t.end
    const e = t.end ?? t.start
    if (s && (!min || s < min)) min = s
    if (e && (!max || e > max)) max = e
  }
  if (!min || !max) {
    const today = startOfDay(new Date())
    return { from: addDays(today, -14), to: addDays(today, 14) }
  }
  const u = unit === 'auto' ? autoUnit(min, max) : unit
  const padDays = u === 'day' ? 2 : u === 'week' ? 7 : 15
  let from = addDays(min, -padDays)
  let to = addDays(max, padDays)
  if (u === 'week') { from = startOfWeek(from); to = addDays(startOfWeek(to), 6) }
  if (u === 'month') {
    from = startOfMonth(from)
    to = addDays(new Date(to.getFullYear(), to.getMonth() + 1, 1), -1)
  }
  return { from, to }
}

/* ---------------------------------------------------------- text + escaping */

let measureCtx: CanvasRenderingContext2D | null = null

function font(size: number, weight = 400): string {
  return `${weight} ${size}px Helvetica, Arial, sans-serif`
}

function measure(text: string, f: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return text.length * 6 // headless fallback
  measureCtx.font = f
  return measureCtx.measureText(text).width
}

// SVG has no text-overflow, so long strings are truncated with a real ellipsis.
function fitText(text: string, maxPx: number, f: string): string {
  if (!text) return ''
  if (measure(text, f) <= maxPx) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(text.slice(0, mid) + '…', f) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return lo <= 0 ? '' : text.slice(0, lo) + '…'
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function darken(color: string, amount = 0.16): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  const n = parseInt(hex, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(v => Math.max(0, Math.round(v * (1 - amount))))
    .map(v => v.toString(16).padStart(2, '0'))
  return `#${ch.join('')}`
}

/* ------------------------------------------------------------- svg emitters */

function rect(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}"${extra}/>`
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, extra = ''): string {
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}"${extra}/>`
}

function text(
  x: number, y: number, s: string, size: number, fill: string,
  opts: { weight?: number; anchor?: 'start' | 'middle' | 'end' } = {},
): string {
  if (!s) return ''
  const anchor = opts.anchor && opts.anchor !== 'start' ? ` text-anchor="${opts.anchor}"` : ''
  const weight = opts.weight && opts.weight !== 400 ? ` font-weight="${opts.weight}"` : ''
  return `<text x="${r(x)}" y="${r(y)}" font-size="${size}" fill="${fill}"${weight}${anchor}>${esc(s)}</text>`
}

function r(n: number): number {
  return Math.round(n * 100) / 100
}

/* ------------------------------------------------------------ cell contents */

function cellValue(t: GanttTask, col: LhsColumn): string {
  switch (col) {
    case 'name': return t.name
    case 'start': return t.start ? fmtDate(t.start) : ''
    case 'end': return t.end ? fmtDate(t.end) : ''
    case 'duration':
      if (isMilestone(t)) return t.end || t.start ? '0' : ''
      return t.start && t.end ? String(daysBetween(t.start, t.end) + 1) : ''
    case 'status': return t.status ?? ''
    case 'assignees': return (t.assignees ?? []).map(a => a.username).join(', ')
    case 'priority': return t.priority ? PRIORITY_LABELS[t.priority] : ''
    case 'tags': return (t.tags ?? []).map(g => g.name).join(', ')
    case 'id': return t.clickupId ?? t.id.slice(0, 8)
  }
}

/* -------------------------------------------------------------- bar geometry */

interface BarGeom {
  x: number       // chart-local, already clamped to the window
  w: number
  cy: number      // vertical centre of the row
  milestone: boolean
  clipLeft: boolean
  clipRight: boolean
}

/* -------------------------------------------------------------------- build */

export function buildGanttSvg(tasks: GanttTask[], opts: ExportOptions): BuiltSvg {
  const columns = opts.columns.includes('name') ? opts.columns : ['name' as LhsColumn, ...opts.columns]
  const lhsW = lhsWidth(columns)
  const ppd = PX_PER_DAY[opts.unit]
  const chartW = chartWidth(opts.from, opts.to, opts.unit)
  const titleH = opts.title ? TITLE_H : 0
  const bodyY = titleH + HEADER_H
  const height = bodyY + tasks.length * ROW_H
  const width = lhsW + chartW

  // chart-local x for a date (day-granular)
  const x = (d: Date): number => daysBetween(opts.from, d) * ppd
  const cx = (v: number): number => lhsW + v // chart-local -> absolute

  const rowTop = (i: number): number => bodyY + i * ROW_H
  const barTop = (i: number): number => rowTop(i) + (ROW_H - BAR_H) / 2

  const parts: string[] = []

  /* background */
  parts.push(rect(0, 0, width, height, C.bg))

  /* title */
  if (opts.title) {
    parts.push(text(CELL_PAD, titleH / 2 + 6, opts.title, 15, C.text, { weight: 600 }))
  }

  /* row bands */
  for (let i = 0; i < tasks.length; i++) {
    if (i % 2 === 1) parts.push(rect(0, rowTop(i), width, ROW_H, C.rowAlt))
  }

  /* weekend shading (day view only) */
  if (opts.unit === 'day' && tasks.length > 0) {
    for (const d of unitStarts(opts.from, opts.to, 'day')) {
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6) continue
      parts.push(rect(cx(x(d)), bodyY, ppd, height - bodyY, C.weekend))
    }
  }

  /* today highlight */
  const today = startOfDay(new Date())
  const todayVisible = opts.showToday && today >= startOfDay(opts.from) && today <= startOfDay(opts.to)
  if (todayVisible) {
    parts.push(rect(cx(x(today)), bodyY, Math.max(2, ppd), height - bodyY, '#fff4e0'))
  }

  /* vertical grid */
  for (const d of unitStarts(opts.from, opts.to, opts.unit)) {
    const gx = cx(x(d))
    if (gx <= lhsW) continue
    parts.push(line(gx, bodyY, gx, height, C.tick, ' stroke-width="1"'))
  }
  if (opts.unit !== 'month') {
    for (const d of monthStarts(opts.from, opts.to)) {
      const gx = cx(x(d))
      if (gx <= lhsW) continue
      parts.push(line(gx, bodyY, gx, height, C.tickThick, ' stroke-width="1"'))
    }
  }

  /* header band */
  parts.push(rect(0, titleH, width, HEADER_H, C.headerBg))
  parts.push(line(0, titleH + HEADER_H, width, titleH + HEADER_H, C.borderStrong, ' stroke-width="1"'))
  parts.push(line(lhsW, titleH + HEADER_H / 2, width, titleH + HEADER_H / 2, C.border, ' stroke-width="1"'))

  // upper band: months (day/week view) or years (month view)
  const upperGroups = opts.unit === 'month'
    ? yearStarts(opts.from, opts.to).map(d => ({ start: d, label: String(d.getFullYear()) }))
    : monthStarts(opts.from, opts.to).map(d => ({ start: d, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }))
  const upperFont = font(11, 600)
  for (let i = 0; i < upperGroups.length; i++) {
    const g = upperGroups[i]
    const nextStart = upperGroups[i + 1]?.start ?? addDays(opts.to, 1)
    const gx0 = Math.max(0, x(g.start))
    const gx1 = Math.min(chartW, x(nextStart))
    if (gx1 - gx0 < 14) continue
    if (gx0 > 0) parts.push(line(cx(gx0), titleH, cx(gx0), titleH + HEADER_H, C.border, ' stroke-width="1"'))
    const label = fitText(g.label, gx1 - gx0 - 8, upperFont)
    parts.push(text(cx(gx0) + 5, titleH + HEADER_H / 2 - 6, label, 11, C.textMid, { weight: 600 }))
  }

  // lower band: per-column tick labels
  const lowerFont = font(10)
  const cols = unitStarts(opts.from, opts.to, opts.unit)
  for (let i = 0; i < cols.length; i++) {
    const d = cols[i]
    const next = cols[i + 1] ?? addDays(opts.to, 1)
    const gx0 = Math.max(0, x(d))
    const gx1 = Math.min(chartW, x(next))
    const w = gx1 - gx0
    if (w < 10) continue
    const label =
      opts.unit === 'day' ? String(d.getDate()) :
      opts.unit === 'week' ? `${d.getDate()} ${MONTHS[d.getMonth()]}` :
      MONTHS[d.getMonth()]
    const fitted = fitText(label, w - 4, lowerFont)
    const isWeekend = opts.unit === 'day' && (d.getDay() === 0 || d.getDay() === 6)
    parts.push(text(cx(gx0 + w / 2), titleH + HEADER_H - 6, fitted, 10,
      isWeekend ? C.textMuted : C.textMid, { anchor: 'middle' }))
  }

  /* left column block */
  let colX = 0
  const headFont = font(10, 600)
  for (const col of columns) {
    const cw = COLUMNS[col].width
    if (colX > 0) {
      parts.push(line(colX, titleH, colX, height, C.border, ' stroke-width="1"'))
    }
    parts.push(text(colX + CELL_PAD, titleH + HEADER_H - 7,
      fitText(COLUMNS[col].label, cw - 2 * CELL_PAD, headFont), 10, C.textMuted, { weight: 600 }))
    colX += cw
  }
  parts.push(line(lhsW, titleH, lhsW, height, C.borderStrong, ' stroke-width="1"'))

  /* row separators + cell text */
  const cellFont = font(11)
  const nameFont = font(11, 500)
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    const ty = rowTop(i) + ROW_H / 2 + 4
    if (i > 0) parts.push(line(0, rowTop(i), width, rowTop(i), C.border, ' stroke-width="1"'))

    let cxPos = 0
    for (const col of columns) {
      const cw = COLUMNS[col].width
      if (col === 'name') {
        let tx = cxPos + CELL_PAD
        let avail = cw - 2 * CELL_PAD
        if (isMilestone(t)) {
          parts.push(text(tx, ty, '◆', 10, C.milestone))
          tx += 14
          avail -= 14
        }
        parts.push(text(tx, ty, fitText(t.name, avail, nameFont), 11, C.text, { weight: 500 }))
      } else {
        const v = cellValue(t, col)
        if (v) {
          parts.push(text(cxPos + CELL_PAD, ty,
            fitText(v, cw - 2 * CELL_PAD, cellFont), 11, C.textMid))
        }
      }
      cxPos += cw
    }
  }
  parts.push(line(0, height - 0.5, width, height - 0.5, C.border, ' stroke-width="1"'))

  /* bars + milestones */
  const geoms = new Map<string, BarGeom>()
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    const ms = isMilestone(t)
    const start = ms ? (t.end ?? t.start) : t.start
    const end = ms ? (t.end ?? t.start) : t.end

    if (!start || !end) {
      parts.push(text(cx(4) + 4, rowTop(i) + ROW_H / 2 + 4, 'no dates', 10, '#c4c4c4'))
      continue
    }

    const cyRow = rowTop(i) + ROW_H / 2
    // On the critical path the fill is left alone (a ClickUp status colour stays
    // readable) and the outline carries the marking.
    const crit = opts.criticalIds?.has(t.id) ?? false

    if (ms) {
      const centre = x(start) + ppd / 2
      if (centre < -MS_HALF || centre > chartW + MS_HALF) continue
      const gx = cx(centre)
      parts.push(
        `<rect x="${r(gx - MS_SIDE / 2)}" y="${r(cyRow - MS_SIDE / 2)}" width="${MS_SIDE}" height="${MS_SIDE}" ` +
        `fill="${C.milestone}" stroke="${crit ? C.critical : darken(C.milestone)}" ` +
        `stroke-width="${crit ? 2 : 1}" ` +
        `transform="rotate(45 ${r(gx)} ${r(cyRow)})"/>`,
      )
      geoms.set(t.id, {
        x: centre - MS_HALF, w: MS_HALF * 2, cy: cyRow,
        milestone: true, clipLeft: false, clipRight: false,
      })
      continue
    }

    const rawX0 = x(start)
    const rawX1 = x(end) + ppd // end date is inclusive
    if (rawX1 <= 0 || rawX0 >= chartW) continue
    const x0 = Math.max(0, rawX0)
    const x1 = Math.min(chartW, rawX1)
    const w = Math.max(2, x1 - x0)
    const fill = t.statusColor || C.bar
    const top = barTop(i)

    parts.push(
      `<rect x="${r(cx(x0))}" y="${r(top)}" width="${r(w)}" height="${BAR_H}" rx="3" ` +
      `fill="${fill}" stroke="${crit ? C.critical : darken(fill)}" ` +
      `stroke-width="${crit ? 2 : 1}"/>`,
    )

    // chevrons mark an edge that runs outside the exported window
    if (rawX0 < 0) {
      parts.push(`<path d="M ${r(cx(x0) + 7)} ${r(top + 3)} L ${r(cx(x0) + 3)} ${r(top + BAR_H / 2)} L ${r(cx(x0) + 7)} ${r(top + BAR_H - 3)}" fill="none" stroke="#fff" stroke-width="1.4"/>`)
    }
    if (rawX1 > chartW) {
      parts.push(`<path d="M ${r(cx(x1) - 7)} ${r(top + 3)} L ${r(cx(x1) - 3)} ${r(top + BAR_H / 2)} L ${r(cx(x1) - 7)} ${r(top + BAR_H - 3)}" fill="none" stroke="#fff" stroke-width="1.4"/>`)
    }

    geoms.set(t.id, {
      x: x0, w, cy: cyRow, milestone: false,
      clipLeft: rawX0 < 0, clipRight: rawX1 > chartW,
    })
  }

  /* today line on top of the bars */
  if (todayVisible) {
    const tx = cx(x(today) + ppd / 2)
    parts.push(line(tx, titleH + HEADER_H / 2, tx, height, C.today,
      ' stroke-width="1.2" stroke-dasharray="4 3"'))
  }

  /* dependency arrows */
  if (opts.showArrows) {
    const index = new Map<string, number>()
    tasks.forEach((t, i) => index.set(t.id, i))
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]
      for (const depId of t.dependencies ?? []) {
        const fromIdx = index.get(depId)
        if (fromIdx === undefined) continue
        const fromG = geoms.get(depId)
        const toG = geoms.get(t.id)
        if (!fromG || !toG) continue
        parts.push(arrowPath(fromG, toG, cx,
          opts.criticalEdges?.has(edgeKey(depId, t.id)) ?? false))
      }
    }
  }

  return { body: parts.join(''), width, height }
}

// Elbow connector, ported from src/lib/frappe-gantt/arrow.js:13-89 with the
// export geometry substituted for the library's padding / header_height.
function arrowPath(
  from: BarGeom, to: BarGeom, cx: (v: number) => number, critical: boolean,
): string {
  let startX = from.x + from.w / 2
  while (to.x < startX + ARROW_PAD && startX > from.x + ARROW_PAD) startX -= 10
  startX -= 10

  const startY = from.cy + (from.milestone ? MS_HALF : BAR_H / 2)
  const endX = to.x - 11
  const endY = to.cy
  const fromIsBelow = from.cy > to.cy
  const clockwise = fromIsBelow ? 1 : 0

  let d: string
  if (to.x <= from.x + ARROW_PAD) {
    // successor starts left of the predecessor: route around it
    let curve = CURVE
    let curveY = fromIsBelow ? -curve : curve
    let down1 = ARROW_PAD / 2 - curve
    if (down1 < 0) {
      down1 = 0
      curve = ARROW_PAD / 2
      curveY = fromIsBelow ? -curve : curve
    }
    const down2 = to.cy - curveY
    const left = to.x - ARROW_PAD
    d = `M ${r(cx(startX))} ${r(startY)}` +
        ` v ${r(down1)}` +
        ` a ${curve} ${curve} 0 0 1 ${-curve} ${curve}` +
        ` H ${r(cx(left))}` +
        ` a ${curve} ${curve} 0 0 ${clockwise} ${-curve} ${r(curveY)}` +
        ` V ${r(down2)}` +
        ` a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${r(curveY)}` +
        ` L ${r(cx(endX))} ${r(endY)}` +
        ` m -5 -5 l 5 5 l -5 5`
  } else {
    let curve = CURVE
    if (endX < startX + curve) curve = Math.max(0, endX - startX)
    const offset = fromIsBelow ? endY + curve : endY - curve
    d = `M ${r(cx(startX))} ${r(startY)}` +
        ` V ${r(offset)}` +
        ` a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${fromIsBelow ? -curve : curve}` +
        ` L ${r(cx(endX))} ${r(endY)}` +
        ` m -5 -5 l 5 5 l -5 5`
  }
  return `<path d="${d}" fill="none" stroke="${critical ? C.critical : C.arrow}" ` +
         `stroke-width="${critical ? 2.4 : 1.2}"/>`
}

/* ------------------------------------------------------------- svg document */

export function svgDocument(
  built: BuiltSvg,
  size?: { width: string; height: string },
): string {
  // Explicit width/height (not just a viewBox) is required for rasterization
  // through <img>: Firefox has no intrinsic size otherwise.
  const w = size?.width ?? `${built.width}`
  const h = size?.height ?? `${built.height}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${r(built.width)} ${r(built.height)}" ` +
    `preserveAspectRatio="xMinYMin meet" ` +
    `font-family="Helvetica, Arial, sans-serif">${built.body}</svg>`
  )
}
