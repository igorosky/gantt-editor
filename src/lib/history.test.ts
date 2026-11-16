import { describe, expect, it } from 'vitest'
import { emptyHistory, record, redo, undo } from './history'

describe('history', () => {
  it('undoes and redoes in order, with labels', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, 'one')
    h = record(h, 1, 'two')
    const u1 = undo(h, 2)!
    expect(u1.state).toBe(1)
    expect(u1.label).toBe('two')
    const u2 = undo(u1.history, u1.state)!
    expect(u2.state).toBe(0)
    expect(undo(u2.history, u2.state)).toBeNull()
    const r1 = redo(u2.history, u2.state)!
    expect(r1.state).toBe(1)
    expect(r1.label).toBe('one')
    const r2 = redo(r1.history, r1.state)!
    expect(r2.state).toBe(2)
    expect(redo(r2.history, r2.state)).toBeNull()
  })

  it('a new action drops the redo stack', () => {
    let h = record(emptyHistory<number>(), 0, 'a')
    const u = undo(h, 1)!
    h = record(u.history, 0, 'b')
    expect(h.future).toEqual([])
    expect(redo(h, 5)).toBeNull()
  })

  it('actions with the same key as the newest entry coalesce into it', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, 'drag', 'g1')
    h = record(h, 1, 'drag', 'g1')
    h = record(h, 2, 'drag', 'g1')
    expect(h.past).toHaveLength(1)
    expect(undo(h, 3)!.state).toBe(0)
    h = record(h, 3, 'drag', 'g2')
    expect(h.past).toHaveLength(2)
  })

  it('a coalesced action still clears redo', () => {
    let h = record(emptyHistory<number>(), 0, 'x', 'k')
    h = { past: h.past, future: [{ state: 9, label: 'y' }] }
    h = record(h, 1, 'x', 'k')
    expect(h.future).toEqual([])
  })

  it('keeps at most the limit, dropping the oldest', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 5; i++) h = record(h, i, `s${i}`, undefined, 3)
    expect(h.past.map(e => e.state)).toEqual([2, 3, 4])
  })
})
