import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION, click, inOrder, lastInOrder, prune, range, selectOnly, step, toggle, type Selection,
} from './selection'

const order = ['a', 'b', 'c', 'd', 'e']
const ids = (s: Selection) => [...s.ids].sort()

describe('selection', () => {
  it('a plain click selects one task and sets the anchor', () => {
    const s = click(selectOnly('a'), order, 'c')
    expect(ids(s)).toEqual(['c'])
    expect(s.anchor).toBe('c')
  })

  it('Ctrl / Cmd toggles one task and moves the anchor', () => {
    let s = click(selectOnly('a'), order, 'c', { toggle: true })
    expect(ids(s)).toEqual(['a', 'c'])
    s = click(s, order, 'a', { toggle: true })
    expect(ids(s)).toEqual(['c'])
    expect(s.anchor).toBe('a')
  })

  it('Shift selects the range from the anchor, both directions, keeping the anchor', () => {
    let s = click(selectOnly('b'), order, 'd', { shift: true })
    expect(ids(s)).toEqual(['b', 'c', 'd'])
    expect(s.anchor).toBe('b')
    s = click(s, order, 'a', { shift: true })
    expect(ids(s)).toEqual(['a', 'b'])
  })

  it('Ctrl+Shift adds the range to the selection', () => {
    const s = click({ ids: new Set(['e']), anchor: 'a' }, order, 'b', { shift: true, toggle: true })
    expect(ids(s)).toEqual(['a', 'b', 'e'])
  })

  it('Shift without a visible anchor selects just the task', () => {
    expect(ids(range(EMPTY_SELECTION, order, 'c'))).toEqual(['c'])
    expect(ids(range({ ids: new Set(['x']), anchor: 'x' }, order, 'c'))).toEqual(['c'])
    expect(range(EMPTY_SELECTION, order, 'zz')).toBe(EMPTY_SELECTION)
  })

  it('arrow steps move one row, clamped, starting at the edges', () => {
    expect(ids(step(EMPTY_SELECTION, order, 1))).toEqual(['a'])
    expect(ids(step(EMPTY_SELECTION, order, -1))).toEqual(['e'])
    expect(ids(step(selectOnly('b'), order, 1))).toEqual(['c'])
    expect(ids(step(selectOnly('e'), order, 1))).toEqual(['e'])
    expect(ids(step(selectOnly('a'), order, -1))).toEqual(['a'])
    expect(step(EMPTY_SELECTION, [], 1)).toBe(EMPTY_SELECTION)
  })

  it('Shift+arrow grows and shrinks the range from the anchor', () => {
    let s = step(selectOnly('b'), order, 1, true)
    expect(ids(s)).toEqual(['b', 'c'])
    s = step(s, order, 1, true)
    expect(ids(s)).toEqual(['b', 'c', 'd'])
    s = step(s, order, -1, true)
    expect(ids(s)).toEqual(['b', 'c'])
    expect(s.anchor).toBe('b')
  })

  it('the moving end of a range is the row furthest from the anchor', () => {
    expect(lastInOrder({ ids: new Set(['b', 'c', 'd']), anchor: 'b' }, order)).toBe('d')
    expect(lastInOrder({ ids: new Set(['b', 'c', 'd']), anchor: 'd' }, order)).toBe('b')
    expect(lastInOrder(EMPTY_SELECTION, order)).toBeNull()
  })

  it('prune drops deleted tasks and keeps identity when nothing changed', () => {
    const s = { ids: new Set(['a', 'b']), anchor: 'a' }
    expect(prune(s, () => true)).toBe(s)
    const p = prune(s, id => id !== 'a')
    expect(ids(p)).toEqual(['b'])
    expect(p.anchor).toBeNull()
  })

  it('toggle on an empty selection selects', () => {
    expect(ids(toggle(EMPTY_SELECTION, 'a'))).toEqual(['a'])
  })

  it('inOrder lists the selection in display order, hidden ones last', () => {
    expect(inOrder({ ids: new Set(['x', 'd', 'b']), anchor: null }, order)).toEqual(['b', 'd', 'x'])
  })
})
