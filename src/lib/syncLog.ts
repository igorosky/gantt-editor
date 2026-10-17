import type { SyncLogEntry, SyncLogKind, SyncReport } from '../types'

// Display order of the groups in the log; problems first
export const KIND_ORDER: SyncLogKind[] = [
  'error', 'skipped', 'resolved', 'updated', 'added', 'created', 'moved', 'removed', 'deleted', 'dep-added', 'dep-removed', 'info',
]

export const KIND_LABEL: Record<SyncLogKind, string> = {
  error: 'Errors',
  skipped: 'Skipped',
  resolved: 'Conflicts resolved',
  updated: 'Updated',
  added: 'Added to board',
  created: 'Created in ClickUp',
  moved: 'Moved',
  removed: 'Removed from board',
  deleted: 'Deleted in ClickUp',
  'dep-added': 'Dependencies added',
  'dep-removed': 'Dependencies removed',
  info: 'Notes',
}

// Singular / plural nouns for the one-line summary; notes are not counted
const COUNT_WORD: Partial<Record<SyncLogKind, [string, string]>> = {
  updated: ['updated', 'updated'],
  added: ['added', 'added'],
  created: ['created', 'created'],
  moved: ['moved', 'moved'],
  removed: ['removed', 'removed'],
  deleted: ['deleted', 'deleted'],
  'dep-added': ['dep added', 'deps added'],
  'dep-removed': ['dep removed', 'deps removed'],
  skipped: ['skipped', 'skipped'],
  resolved: ['resolved', 'resolved'],
  error: ['error', 'errors'],
}

// Entries kept per run, so the stored log stays well under the quota
export const MAX_ENTRIES = 500

export function clipText(s: string, n = 60): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export function groupEntries(entries: SyncLogEntry[]): Array<[SyncLogKind, SyncLogEntry[]]> {
  const by = new Map<SyncLogKind, SyncLogEntry[]>()
  for (const e of entries) {
    const list = by.get(e.kind)
    if (list) list.push(e)
    else by.set(e.kind, [e])
  }
  return KIND_ORDER.filter(k => by.has(k)).map(k => [k, by.get(k)!])
}

export function runCounts(run: SyncReport): Partial<Record<SyncLogKind, number>> {
  const out: Partial<Record<SyncLogKind, number>> = {}
  for (const e of run.entries) out[e.kind] = (out[e.kind] ?? 0) + 1
  return out
}

export const runFailed = (run: SyncReport): boolean =>
  !!run.aborted || run.entries.some(e => e.kind === 'error')

// "3 updated, 1 added, 1 error", or "no changes"
export function countsText(run: SyncReport): string {
  const counts = runCounts(run)
  const parts: string[] = []
  for (const k of KIND_ORDER) {
    const n = counts[k]
    const word = COUNT_WORD[k]
    if (!n || !word) continue
    parts.push(`${n} ${word[n === 1 ? 0 : 1]}`)
  }
  return parts.length ? parts.join(', ') : 'no changes'
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// One line for the header chip
export function runSummary(run: SyncReport): string {
  if (run.aborted) return `${run.direction === 'pull' ? 'Pull' : 'Push'} failed ${hhmm(run.at)}: ${run.aborted}`
  return `${run.direction === 'pull' ? 'Pulled' : 'Pushed'} ${hhmm(run.at)} · ${countsText(run)}`
}

// Drops entries past MAX_ENTRIES, errors last of all
export function capRun(run: SyncReport): SyncReport {
  if (run.entries.length <= MAX_ENTRIES) return run
  const errors = run.entries.filter(e => e.kind === 'error').slice(0, MAX_ENTRIES)
  const room = MAX_ENTRIES - errors.length
  const keep = new Set([...errors, ...run.entries.filter(e => e.kind !== 'error').slice(0, room)])
  return {
    ...run,
    entries: run.entries.filter(e => keep.has(e)),
    truncated: (run.truncated ?? 0) + run.entries.length - keep.size,
  }
}
