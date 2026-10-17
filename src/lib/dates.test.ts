import { describe, expect, it } from 'vitest'
import {
  addDays, autoUnit, daysBetween, isoDay, shiftDays, startOfWeek, unitBoundaries, unitStarts,
} from './dates'

// npm test runs with TZ=Europe/Warsaw so the DST cases below are real:
// clocks go forward on 2026-03-29 and back on 2026-10-25.

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(startOfWeek(new Date(2026, 9, 14))).toEqual(new Date(2026, 9, 12)) // Wed -> Mon
    expect(startOfWeek(new Date(2026, 9, 18))).toEqual(new Date(2026, 9, 12)) // Sun -> Mon
    expect(startOfWeek(new Date(2026, 9, 12, 15))).toEqual(new Date(2026, 9, 12))
  })

  it('counts whole days across DST changes', () => {
    expect(daysBetween(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2)
    expect(daysBetween(new Date(2026, 9, 24), new Date(2026, 9, 26))).toBe(2)
    expect(addDays(new Date(2026, 9, 24), 2)).toEqual(new Date(2026, 9, 26))
    expect(addDays(new Date(2026, 9, 24), 2).getHours()).toBe(0)
  })

  it('formats the local day, whatever the time of day', () => {
    // Local midnight is the previous day in UTC here
    expect(isoDay(new Date(2026, 9, 17))).toBe('2026-10-17')
    expect(isoDay(new Date(2026, 9, 17, 4))).toBe('2026-10-17')
    expect(isoDay(new Date(2026, 9, 17, 23, 59, 59))).toBe('2026-10-17')
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('shifts by calendar days keeping the time of day across DST', () => {
    expect(shiftDays(new Date(2026, 9, 20), 7)).toEqual(new Date(2026, 9, 27))
    expect(shiftDays(new Date(2026, 9, 20, 23, 59, 59), 7)).toEqual(new Date(2026, 9, 27, 23, 59, 59))
    expect(shiftDays(new Date(2026, 9, 27, 4), -7)).toEqual(new Date(2026, 9, 20, 4))
    expect(shiftDays(new Date(2026, 2, 27), 3)).toEqual(new Date(2026, 2, 30))
  })

  it('lists month starts covering the range', () => {
    expect(unitStarts(new Date(2026, 0, 15), new Date(2026, 2, 2), 'month'))
      .toEqual([new Date(2026, 0, 1), new Date(2026, 1, 1), new Date(2026, 2, 1)])
  })

  it('gives n + 1 boundaries for n buckets', () => {
    const b = unitBoundaries(new Date(2026, 9, 14), new Date(2026, 9, 27), 'week')
    expect(b).toEqual([new Date(2026, 9, 12), new Date(2026, 9, 19), new Date(2026, 9, 26), new Date(2026, 10, 2)])
    expect(unitBoundaries(new Date(2026, 9, 14), new Date(2026, 9, 13), 'day')).toEqual([])
  })

  it('picks a unit by range length', () => {
    expect(autoUnit(new Date(2026, 0, 1), new Date(2026, 1, 1))).toBe('day')
    expect(autoUnit(new Date(2026, 0, 1), new Date(2026, 11, 1))).toBe('week')
    expect(autoUnit(new Date(2026, 0, 1), new Date(2028, 0, 1))).toBe('month')
  })
})
