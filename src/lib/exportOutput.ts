// Output pipelines for the export feature: rasterize the generated SVG to a PNG
// download, or paginate it and hand it to the browser's print dialog (which is
// what produces the PDF, so no PDF library is needed).

import type { GanttTask } from '../types'
import {
  buildGanttSvg, chartWidth, headerBlockHeight, lhsWidth, svgDocument,
  unitStarts, addDays, ROW_H,
} from './exportGantt'
import type { BuiltSvg, ExportOptions } from './exportGantt'

/* ------------------------------------------------------------------- paper */

export type PaperName = 'a4' | 'a3' | 'letter'

const PAPER_MM: Record<PaperName, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
}

export const PAPER_LABELS: Record<PaperName, string> = {
  a4: 'A4', a3: 'A3', letter: 'Letter',
}

const MARGIN_MM = 10
const FOOTER_MM = 6

export const mmToPx = (mm: number): number => (mm / 25.4) * 96
export const pxToMm = (px: number): number => (px / 96) * 25.4

export interface PaperGeom {
  pageWmm: number
  pageHmm: number
  usableWmm: number
  usableHmm: number
  usableWpx: number
  usableHpx: number
}

export function paperGeom(name: PaperName, landscape: boolean): PaperGeom {
  let [w, h] = PAPER_MM[name]
  if (landscape) [w, h] = [h, w]
  const usableWmm = w - 2 * MARGIN_MM
  const usableHmm = h - 2 * MARGIN_MM - FOOTER_MM
  return {
    pageWmm: w,
    pageHmm: h,
    usableWmm,
    usableHmm,
    usableWpx: mmToPx(usableWmm),
    usableHpx: mmToPx(usableHmm),
  }
}

/* -------------------------------------------------------------- pagination */

export interface PageSpec {
  built: BuiltSvg
  label: string
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Greedy split of the date window into chunks no wider than maxW, cut on unit
// column boundaries so no column is ever sliced in half.
function dateSlices(
  from: Date, to: Date, unit: ExportOptions['unit'], maxW: number, weekStart?: number,
): { from: Date; to: Date }[] {
  if (chartWidth(from, to, unit) <= maxW) return [{ from, to }]
  const starts = unitStarts(from, to, unit, weekStart)
  const out: { from: Date; to: Date }[] = []
  let sliceFrom = from
  for (let i = 0; i < starts.length; i++) {
    const colEnd = i + 1 < starts.length ? addDays(starts[i + 1], -1) : to
    if (chartWidth(sliceFrom, colEnd, unit) > maxW && starts[i] > sliceFrom) {
      out.push({ from: sliceFrom, to: addDays(starts[i], -1) })
      sliceFrom = starts[i]
    }
  }
  out.push({ from: sliceFrom, to })
  return out
}

export function buildPages(
  tasks: GanttTask[],
  opts: ExportOptions,
  geom: PaperGeom,
  multipage: boolean,
): PageSpec[] {
  if (!multipage) {
    // Everything on one sheet; the print CSS scales it down to fit.
    const built = buildGanttSvg(tasks, opts)
    return [{ built, label: `${fmtShort(opts.from)} – ${fmtShort(opts.to)}` }]
  }

  const rowsPerPage = Math.max(
    1,
    Math.floor((geom.usableHpx - headerBlockHeight(opts)) / ROW_H),
  )
  const chartRoom = Math.max(120, geom.usableWpx - lhsWidth(opts.columns))
  const slices = dateSlices(opts.from, opts.to, opts.unit, chartRoom, opts.calendar?.weekStart)

  const pages: PageSpec[] = []
  for (let r = 0; r < Math.max(1, tasks.length); r += rowsPerPage) {
    const rowSlice = tasks.slice(r, r + rowsPerPage)
    if (rowSlice.length === 0) break
    for (const s of slices) {
      pages.push({
        built: buildGanttSvg(rowSlice, { ...opts, from: s.from, to: s.to }),
        label:
          `Tasks ${r + 1}–${r + rowSlice.length} of ${tasks.length}` +
          `  ·  ${fmtShort(s.from)} – ${fmtShort(s.to)}`,
      })
    }
  }
  return pages
}

export function pageCount(
  tasks: GanttTask[], opts: ExportOptions, geom: PaperGeom, multipage: boolean,
): number {
  if (!multipage) return 1
  const rowsPerPage = Math.max(1, Math.floor((geom.usableHpx - headerBlockHeight(opts)) / ROW_H))
  const chartRoom = Math.max(120, geom.usableWpx - lhsWidth(opts.columns))
  const slices = dateSlices(opts.from, opts.to, opts.unit, chartRoom, opts.calendar?.weekStart)
  return Math.max(1, Math.ceil(tasks.length / rowsPerPage)) * slices.length
}

/* --------------------------------------------------------------------- PNG */

// Browsers cap canvas dimensions (~16384px per side) and total area. Rather
// than handing back a blank image, fall back to the largest scale that fits.
const MAX_CANVAS_DIM = 16384
const MAX_CANVAS_AREA = 200_000_000

export function effectiveScale(width: number, height: number, scale: number): number {
  let s = scale
  while (s > 1) {
    const w = width * s
    const h = height * s
    if (w <= MAX_CANVAS_DIM && h <= MAX_CANVAS_DIM && w * h <= MAX_CANVAS_AREA) break
    s -= 1
  }
  return Math.max(1, s)
}

function loadSvgImage(svgText: string): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const revoke = () => URL.revokeObjectURL(url)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ img, revoke })
    img.onerror = () => { revoke(); reject(new Error('Could not rasterize the chart')) }
    img.src = url
  })
}

export async function downloadPng(
  built: BuiltSvg, scale: number, filename: string,
): Promise<number> {
  const s = effectiveScale(built.width, built.height, scale)
  const svgText = svgDocument(built)
  const { img, revoke } = await loadSvgImage(svgText)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(built.width * s)
  canvas.height = Math.round(built.height * s)
  const ctx = canvas.getContext('2d')
  if (!ctx) { revoke(); throw new Error('Canvas 2D context unavailable') }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  revoke()

  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return s
}

/* --------------------------------------------------------------------- PDF */

export function printPages(pages: PageSpec[], geom: PaperGeom, docTitle: string): void {
  const sheets = pages.map((p, i) => {
    // Never upscale: fit the natural px size into the usable area, in mm.
    const wMm = pxToMm(p.built.width)
    const hMm = pxToMm(p.built.height)
    const s = Math.min(1, geom.usableWmm / wMm, geom.usableHmm / hMm)
    const svg = svgDocument(p.built, {
      width: `${(wMm * s).toFixed(2)}mm`,
      height: `${(hMm * s).toFixed(2)}mm`,
    })
    const foot = pages.length > 1
      ? `${p.label}  ·  Page ${i + 1} / ${pages.length}`
      : p.label
    return `<div class="page"><div class="sheet">${svg}</div><div class="foot">${escapeHtml(foot)}</div></div>`
  }).join('')

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>` +
    `@page { size: ${geom.pageWmm}mm ${geom.pageHmm}mm; margin: 0 }` +
    `html, body { margin: 0; padding: 0; background: #fff; ` +
    `-webkit-print-color-adjust: exact; print-color-adjust: exact }` +
    `.page { width: ${geom.pageWmm}mm; height: ${geom.pageHmm}mm; padding: ${MARGIN_MM}mm; ` +
    `box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; ` +
    `page-break-after: always; break-after: page }` +
    `.page:last-child { page-break-after: auto; break-after: auto }` +
    `.sheet { flex: 1; min-height: 0; overflow: hidden }` +
    `.foot { height: ${FOOTER_MM}mm; display: flex; align-items: flex-end; ` +
    `font: 8pt Helvetica, Arial, sans-serif; color: #888 }` +
    `svg { display: block }` +
    `</style></head><body>${sheets}</body></html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed', right: '0', bottom: '0',
    width: '0', height: '0', border: '0', visibility: 'hidden',
  } as CSSStyleDeclaration)
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) { iframe.remove(); throw new Error('Could not open the print view') }

  doc.open()
  doc.write(html)
  doc.close()

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    iframe.remove()
  }
  win.addEventListener('afterprint', cleanup)

  // Give the browser a frame to lay the SVGs out before opening the dialog.
  win.setTimeout(() => {
    win.focus()
    win.print()
    // Safari/Firefox do not always fire afterprint.
    window.setTimeout(cleanup, 60000)
  }, 100)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
