import { describe, expect, it } from 'vitest'
import { defaultStatus, sameStatus, statusPatch } from './statuses'

describe('statuses', () => {
  it('the default is the lowest orderindex, whatever the array order', () => {
    const s = [
      { status: 'review', color: '#a', orderindex: 2, type: 'custom' },
      { status: 'Open', color: '#b', orderindex: 0, type: 'open' },
      { status: 'doing', color: '#c', orderindex: 1, type: 'custom' },
    ]
    expect(defaultStatus(s)?.status).toBe('Open')
    expect(defaultStatus([])).toBeUndefined()
  })

  it('a status patch sets name, color and type together', () => {
    expect(statusPatch({ status: 'to do', color: '#87909e', orderindex: 0, type: 'open' }))
      .toEqual({ status: 'to do', statusColor: '#87909e', statusType: 'open' })
  })

  it('compares names without case or padding', () => {
    expect(sameStatus('To Do ', 'to do')).toBe(true)
    expect(sameStatus(undefined, '')).toBe(true)
    expect(sameStatus('done', 'to do')).toBe(false)
  })
})
