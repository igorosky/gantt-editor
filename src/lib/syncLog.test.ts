import { describe, expect, it } from 'vitest'
import type { SyncLogEntry, SyncReport } from '../types'
import { capRun, clipText, countsText, groupEntries, MAX_ENTRIES, runFailed, runSummary } from './syncLog'

function run(entries: SyncLogEntry[], p: Partial<SyncReport> = {}): SyncReport {
  return { id: 'r', direction: 'pull', at: new Date(2026, 9, 15, 14, 32).toISOString(), durationMs: 10, entries, ...p }
}

describe('syncLog', () => {
  it('counts entries per kind, problems first, notes left out', () => {
    const r = run([
      { kind: 'updated' }, { kind: 'updated' }, { kind: 'added' }, { kind: 'info' },
      { kind: 'error' }, { kind: 'dep-added' },
    ])
    expect(countsText(r)).toBe('1 error, 2 updated, 1 added, 1 dep added')
    expect(countsText(run([{ kind: 'info' }]))).toBe('no changes')
    expect(runFailed(r)).toBe(true)
    expect(runFailed(run([{ kind: 'updated' }]))).toBe(false)
  })

  it('summarises a run, or its failure', () => {
    expect(runSummary(run([{ kind: 'updated' }]))).toMatch(/^Pulled .+ · 1 updated$/)
    expect(runSummary(run([], { direction: 'push', aborted: 'Network down' }))).toMatch(/^Push failed .+: Network down$/)
    expect(runFailed(run([], { aborted: 'x' }))).toBe(true)
  })

  it('groups entries in display order', () => {
    const groups = groupEntries([{ kind: 'added' }, { kind: 'error' }, { kind: 'added' }])
    expect(groups.map(([k, list]) => [k, list.length])).toEqual([['error', 1], ['added', 2]])
  })

  it('caps a run, keeping its errors', () => {
    const entries: SyncLogEntry[] = [
      ...Array.from({ length: MAX_ENTRIES + 10 }, (): SyncLogEntry => ({ kind: 'updated' })),
      { kind: 'error', detail: 'late' },
    ]
    const capped = capRun(run(entries))
    expect(capped.entries).toHaveLength(MAX_ENTRIES)
    expect(capped.truncated).toBe(11)
    expect(capped.entries.some(e => e.kind === 'error')).toBe(true)
    const small = run([{ kind: 'updated' }])
    expect(capRun(small)).toBe(small)
  })

  it('clips long text to one line', () => {
    expect(clipText('a\n  b')).toBe('a b')
    expect(clipText('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })
})
