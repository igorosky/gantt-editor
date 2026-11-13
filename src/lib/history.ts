// Undo / redo stacks of board snapshots. Pure and generic: the board stores
// `{ tasks, pending }` snapshots, which share their task objects with the
// live state, so a snapshot costs one array, not a copy of every task.

export interface HistoryEntry<S> {
  state: S // the state before the action (past) / after it (future)
  label: string
  key?: string
}

export interface History<S> {
  past: HistoryEntry<S>[]
  future: HistoryEntry<S>[]
}

export const HISTORY_LIMIT = 100

export function emptyHistory<S>(): History<S> {
  return { past: [], future: [] }
}

// Remembers `prev` (the state before an action). An action carrying the same
// `key` as the newest entry belongs to it (one drag gesture, one batch of
// updates in a single event), so nothing new is recorded: undo goes back to
// before the whole gesture. Any new action drops the redo stack.
export function record<S>(h: History<S>, prev: S, label: string, key?: string, limit = HISTORY_LIMIT): History<S> {
  const top = h.past[h.past.length - 1]
  if (key !== undefined && top?.key === key) {
    return h.future.length ? { past: h.past, future: [] } : h
  }
  const past = [...h.past, { state: prev, label, key }]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { past, future: [] }
}

export interface Step<S> {
  history: History<S>
  state: S
  label: string
}

// Back to before the newest action; `current` becomes redoable
export function undo<S>(h: History<S>, current: S): Step<S> | null {
  const top = h.past[h.past.length - 1]
  if (!top) return null
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { state: current, label: top.label }] },
    state: top.state,
    label: top.label,
  }
}

// Forward again to the state an undo left
export function redo<S>(h: History<S>, current: S): Step<S> | null {
  const top = h.future[h.future.length - 1]
  if (!top) return null
  return {
    history: { past: [...h.past, { state: current, label: top.label }], future: h.future.slice(0, -1) },
    state: top.state,
    label: top.label,
  }
}
