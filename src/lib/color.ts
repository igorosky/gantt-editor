// Color helpers for status colors: parsing, WCAG contrast and the readable
// text color on top of a fill. Pure.

export interface Rgb { r: number; g: number; b: number }

// Background of a board row (frappe-gantt --g-row-color); a translucent color
// is composited over it, and a fill too close to it gets an outline
export const ROW_BG: Rgb = { r: 0xfd, g: 0xfd, b: 0xfd }

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

// #rgb, #rgba, #rrggbb or #rrggbbaa (alpha composited over white). Anything
// else (names, rgb(), garbage) is null: its contrast cannot be checked.
export function parseColor(s: string | undefined | null): Rgb | null {
  if (typeof s !== 'string') return null
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s.trim())
  if (!m) return null
  let hex = m[1]
  if (hex.length <= 4) hex = hex.split('').map(c => c + c).join('')
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  const rgb = { r: n(0), g: n(2), b: n(4) }
  if (hex.length === 6) return rgb
  const a = n(6) / 255
  const mix = (v: number) => Math.round(v * a + 255 * (1 - a))
  return { r: mix(rgb.r), g: mix(rgb.g), b: mix(rgb.b) }
}

export const toHex = ({ r, g, b }: Rgb): string =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// WCAG 2.x relative luminance, 0 (black) .. 1 (white)
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// WCAG contrast ratio, 1 .. 21
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// Black or white, whichever reads better on `bg`. Pure black rather than a
// softer dark gray: the worse of the two choices then never drops below
// 4.58:1, so text on any opaque fill meets WCAG AA.
export function readableTextColor(bg: Rgb | string): '#000000' | '#ffffff' {
  const rgb = typeof bg === 'string' ? parseColor(bg) : bg
  if (!rgb) return '#000000'
  return contrastRatio(rgb, BLACK) >= contrastRatio(rgb, WHITE) ? '#000000' : '#ffffff'
}

// Below this a fill hardly stands out from the row background
export const FAINT_CONTRAST = 1.5

export interface StatusLook {
  fill: string // normalized #rrggbb
  text: '#000000' | '#ffffff' // label color on top of the fill
  faint: boolean // close to the row background: needs an outline
}

// How a task with this status color is drawn; null = keep the default look
export function statusBarStyle(color: string | undefined): StatusLook | null {
  const rgb = parseColor(color)
  if (!rgb) return null
  return {
    fill: toHex(rgb),
    text: readableTextColor(rgb),
    faint: contrastRatio(rgb, ROW_BG) < FAINT_CONTRAST,
  }
}
