// ClickUp list statuses on the board. Pure.

import type { GanttTask } from '../types'
import type { ClickUpStatus } from './clickup'

// The status ClickUp gives a new task in the list: its first one (lowest
// orderindex), which is the "open" status
export function defaultStatus(statuses: readonly ClickUpStatus[]): ClickUpStatus | undefined {
  let best: ClickUpStatus | undefined
  for (const s of statuses) {
    if (!best || Number(s.orderindex) < Number(best.orderindex)) best = s
  }
  return best
}

// The task fields a status sets: name, color and type always change together
export function statusPatch(s: ClickUpStatus): Pick<GanttTask, 'status' | 'statusColor' | 'statusType'> {
  return { status: s.status, statusColor: s.color, statusType: s.type }
}

// ClickUp compares status names without case
export const sameStatus = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
