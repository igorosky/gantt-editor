import { describe, expect, it } from 'vitest'
import {
  ROW_BG, contrastRatio, parseColor, readableTextColor, relativeLuminance, statusBarStyle, toHex,
} from './color'

describe('parseColor', () => {
  it('reads the hex forms', () => {
    expect(parseColor('#4194f6')).toEqual({ r: 0x41, g: 0x94, b: 0xf6 })
    expect(parseColor('#ABC')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
    expect(parseColor('  #000000 ')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('composites a translucent color over white', () => {
    expect(parseColor('#000000ff')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseColor('#00000000')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#0008')).toEqual({ r: 119, g: 119, b: 119 })
  })

  it('rejects anything it cannot check', () => {
    for (const s of [undefined, null, '', 'red', 'rgb(1,2,3)', '#12', '#12345', '#gggggg', '4194f6']) {
      expect(parseColor(s)).toBeNull()
    }
  })
})

describe('contrast', () => {
  it('follows the WCAG formulas', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 6)
    expect(contrastRatio({ r: 9, g: 9, b: 9 }, { r: 9, g: 9, b: 9 })).toBe(1)
    // order does not matter
    const a = parseColor('#4194f6')!
    expect(contrastRatio(a, ROW_BG)).toBeCloseTo(contrastRatio(ROW_BG, a), 10)
  })
})

describe('readableTextColor', () => {
  it('puts white on dark fills and black on light ones', () => {
    expect(readableTextColor('#1f3b8a')).toBe('#ffffff') // navy
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#7b2cbf')).toBe('#ffffff') // purple
    expect(readableTextColor('#d33d44')).toBe('#ffffff') // ClickUp red
    expect(readableTextColor('#ffffff')).toBe('#000000')
    expect(readableTextColor('#d3d3d3')).toBe('#000000') // ClickUp "to do" gray
    expect(readableTextColor('#f9d900')).toBe('#000000') // yellow
    expect(readableTextColor('#6bc950')).toBe('#000000') // ClickUp green
    expect(readableTextColor('#4194f6')).toBe('#000000') // ClickUp blue
  })

  it('keeps text readable (WCAG AA, 4.5:1) on every color', () => {
    let worst = 21
    for (let i = 0; i < 4096; i++) {
      const hex = '#' + i.toString(16).padStart(3, '0')
      const bg = parseColor(hex)!
      const text = parseColor(readableTextColor(bg))!
      worst = Math.min(worst, contrastRatio(bg, text))
    }
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to black for an unknown color', () => {
    expect(readableTextColor('nonsense')).toBe('#000000')
  })
})

describe('statusBarStyle', () => {
  it('is null without a usable color', () => {
    expect(statusBarStyle(undefined)).toBeNull()
    expect(statusBarStyle('')).toBeNull()
    expect(statusBarStyle('blue')).toBeNull()
  })

  it('normalizes the fill and picks the text', () => {
    expect(statusBarStyle('#ABC')).toEqual({ fill: '#aabbcc', text: '#000000', faint: false })
    expect(statusBarStyle('#1f3b8a')).toEqual({ fill: '#1f3b8a', text: '#ffffff', faint: false })
  })

  it('marks fills that blend into the row background', () => {
    expect(statusBarStyle('#ffffff')!.faint).toBe(true)
    expect(statusBarStyle('#fafafa')!.faint).toBe(true)
    expect(statusBarStyle('#f9d900')!.faint).toBe(true) // bright yellow on white
    expect(statusBarStyle('#d3d3d3')!.faint).toBe(true)
    expect(statusBarStyle('#4194f6')!.faint).toBe(false)
    expect(statusBarStyle('#1f3b8a')!.faint).toBe(false)
  })

  it('round-trips through toHex', () => {
    expect(toHex(parseColor('#0a0b0c')!)).toBe('#0a0b0c')
  })
})
