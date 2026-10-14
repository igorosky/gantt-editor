import type { ClickUpConfig, GanttTask, SyncReport } from '../types'
import {
  addDependency,
  addTagToTask,
  createTask,
  fromClickUpDate,
  getAllTasks,
  MILESTONE_ITEM_ID,
  removeTagFromTask,
  toClickUpDate,
  updateTask,
  type RemoteTask,
} from './clickup'

const isRemoteMilestone = (r: RemoteTask): boolean => r.custom_item_id === MILESTONE_ITEM_ID

function sameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.getTime() === b.getTime()
}

const remotePriority = (r: RemoteTask): GanttTask['priority'] =>
  r.priority?.orderindex ? (Number(r.priority.orderindex) as 1 | 2 | 3 | 4) : undefined

const remoteEstimate = (r: RemoteTask): number | undefined =>
  typeof r.time_estimate === 'number' && r.time_estimate > 0 ? r.time_estimate : undefined

// Fresh local row for a remote task. A remote milestone collapses start / end
// onto its due date. Dependencies are left to the caller, since they need the
// clickupId -> local id mapping.
export function mapRemoteTask(r: RemoteTask, id: string): GanttTask {
  const remoteIsMs = isRemoteMilestone(r)
  const rStart = fromClickUpDate(r.start_date)
  const rEnd = fromClickUpDate(r.due_date)
  const msDate = rEnd ?? rStart
  return {
    id,
    clickupId: r.id,
    name: r.name,
    type: remoteIsMs ? 'milestone' : 'task',
    start: (remoteIsMs ? msDate : rStart) ?? undefined,
    end: (remoteIsMs ? msDate : rEnd) ?? undefined,
    progress: 0,
    status: r.status?.status,
    statusColor: r.status?.color,
    statusType: r.status?.type,
    priority: remotePriority(r),
    assignees: r.assignees?.map(a => ({ id: a.id, username: a.username })),
    tags: r.tags?.map(t => ({ name: t.name, tag_bg: t.tag_bg, tag_fg: t.tag_fg })),
    description: r.description,
    timeEstimate: remoteEstimate(r),
  }
}

function buildRemoteEdgeKey(taskId: string, dependsOn: string): string {
  return `${taskId}->${dependsOn}`
}

function topoSort(tasks: GanttTask[]): GanttTask[] {
  const ids = new Set(tasks.map(t => t.id))
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const t of tasks) {
    indegree.set(t.id, 0)
    adj.set(t.id, [])
  }
  for (const t of tasks) {
    for (const predId of t.dependencies ?? []) {
      if (!ids.has(predId)) continue
      adj.get(predId)!.push(t.id)
      indegree.set(t.id, indegree.get(t.id)! + 1)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id)
  }
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const result: GanttTask[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(taskById.get(id)!)
    for (const succId of adj.get(id)!) {
      const deg = indegree.get(succId)! - 1
      indegree.set(succId, deg)
      if (deg === 0) queue.push(succId)
    }
  }
  // Append any cyclic remainder
  const inResult = new Set(result.map(t => t.id))
  for (const t of tasks) {
    if (!inResult.has(t.id)) result.push(t)
  }
  return result
}

export async function syncWithClickUp(
  config: ClickUpConfig,
  localTasks: GanttTask[],
  setTasks: (next: GanttTask[]) => void,
): Promise<SyncReport> {
  const t0 = performance.now()
  const report: SyncReport = {
    added: 0,
    updatedFromRemote: 0,
    pushedToRemote: 0,
    deletedLocal: 0,
    createdRemote: 0,
    depsAdded: 0,
    depsAddedFromRemote: 0,
    errors: [],
    durationMs: 0,
  }

  const lastSyncMs = config.lastSyncAt ? Date.parse(config.lastSyncAt) : 0
  const { token, listId } = config

  // Phase 0 — fetch remote view (fatal on failure)
  const remote = await getAllTasks(token, listId)
  const remoteById = new Map<string, RemoteTask>(remote.map(r => [r.id, r]))

  // Phase 1 — partition local
  const linked = localTasks.filter(t => t.clickupId)
  const unlinked = localTasks.filter(t => !t.clickupId)

  // Working set we'll commit at the end
  const next: GanttTask[] = []

  // Phase 2 — reconcile linked rows
  for (const l of linked) {
    const r = remoteById.get(l.clickupId!)
    if (!r) {
      report.deletedLocal++
      continue
    }
    const remoteUpdated = Number(r.date_updated || 0)
    const remoteChangedSinceSync = lastSyncMs === 0 || remoteUpdated > lastSyncMs
    const remoteStart = fromClickUpDate(r.start_date)
    const remoteEnd = fromClickUpDate(r.due_date)

    const rPriority = remotePriority(r)
    const remoteAssignees = r.assignees?.map(a => ({ id: a.id, username: a.username }))
    const remoteTags = r.tags?.map(t => ({ name: t.name, tag_bg: t.tag_bg, tag_fg: t.tag_fg }))
    const remoteIsMs = isRemoteMilestone(r)
    const localIsMs = l.type === 'milestone'
    // A milestone carries one date locally; the due date is the one ClickUp shows
    const remoteMsDate = remoteEnd ?? remoteStart

    if (remoteChangedSinceSync) {
      const fieldsChanged =
        l.name !== r.name ||
        localIsMs !== remoteIsMs ||
        !sameDay(l.start, remoteIsMs ? remoteMsDate : remoteStart) ||
        !sameDay(l.end, remoteIsMs ? remoteMsDate : remoteEnd)
      next.push({
        ...l,
        name: r.name,
        type: remoteIsMs ? 'milestone' : 'task',
        start: (remoteIsMs ? remoteMsDate : remoteStart) ?? undefined,
        end: (remoteIsMs ? remoteMsDate : remoteEnd) ?? undefined,
        status: r.status?.status,
        statusColor: r.status?.color,
        statusType: r.status?.type,
        priority: rPriority,
        assignees: remoteAssignees,
        tags: remoteTags,
        description: r.description ?? l.description,
        timeEstimate: remoteEstimate(r),
      })
      if (fieldsChanged) report.updatedFromRemote++
    } else {
      const localIds = new Set((l.assignees ?? []).map(a => a.id).filter(id => id !== -1))
      const remoteIds = new Set((r.assignees ?? []).map(a => a.id))
      const addIds = [...localIds].filter(id => !remoteIds.has(id))
      const remIds = [...remoteIds].filter(id => !localIds.has(id))
      const assigneesDiff = (addIds.length || remIds.length)
        ? { assignees: { add: addIds, rem: remIds } }
        : {}
      const localTagNames = new Set((l.tags ?? []).map(t => t.name))
      const remoteTagNames = new Set((remoteTags ?? []).map(t => t.name))
      const addTagNames = [...localTagNames].filter(n => !remoteTagNames.has(n))
      const remTagNames = [...remoteTagNames].filter(n => !localTagNames.has(n))
      const localDiffersFromRemote =
        l.name !== r.name ||
        localIsMs !== remoteIsMs ||
        !sameDay(l.start, remoteStart) ||
        !sameDay(l.end, remoteEnd) ||
        l.priority !== rPriority ||
        (l.description ?? '') !== (r.description ?? '') ||
        (l.status !== undefined && l.status !== r.status?.status) ||
        addIds.length > 0 || remIds.length > 0 ||
        addTagNames.length > 0 || remTagNames.length > 0
      if (localDiffersFromRemote) {
        try {
          await updateTask(token, r.id, {
            name: l.name,
            start_date: l.start ? toClickUpDate(l.start) : null,
            due_date: l.end ? toClickUpDate(l.end) : null,
            ...(l.start ? { start_date_time: false } : {}),
            ...(l.end ? { due_date_time: false } : {}),
            ...(l.priority !== undefined ? { priority: l.priority } : {}),
            ...(l.description !== undefined ? { description: l.description } : {}),
            ...(l.status !== undefined ? { status: l.status } : {}),
            // Only sent on a real type flip, so other custom task types in the
            // workspace are never overwritten
            ...(localIsMs !== remoteIsMs
              ? { custom_item_id: localIsMs ? MILESTONE_ITEM_ID : null }
              : {}),
            ...assigneesDiff,
          })
          await Promise.all([
            ...addTagNames.map(n => addTagToTask(token, r.id, n)),
            ...remTagNames.map(n => removeTagFromTask(token, r.id, n)),
          ])
          report.pushedToRemote++
        } catch (e) {
          report.errors.push(`updateTask(${r.id}): ${String(e)}`)
        }
      }
      // Pull-only fields still follow ClickUp. The status type is only trusted
      // while the status name agrees; a local status change sets its own type.
      next.push({
        ...l,
        timeEstimate: remoteEstimate(r),
        ...(l.status === r.status?.status ? { statusType: r.status?.type } : {}),
      })
    }
  }

  // Phase 3 — create remote for unlinked
  for (const u of unlinked) {
    try {
      const assigneeIds = (u.assignees ?? []).map(a => a.id).filter(id => id !== -1)
      const created = await createTask(token, listId, {
        name: u.name,
        ...(u.type === 'milestone' ? { custom_item_id: MILESTONE_ITEM_ID } : {}),
        ...(u.start ? { start_date: toClickUpDate(u.start), start_date_time: false } : {}),
        ...(u.end ? { due_date: toClickUpDate(u.end), due_date_time: false } : {}),
        ...(u.priority !== undefined ? { priority: u.priority } : {}),
        ...(u.description !== undefined ? { description: u.description } : {}),
        ...(assigneeIds.length ? { assignees: assigneeIds } : {}),
      })
      remoteById.set(created.id, created)
      for (const tag of (u.tags ?? [])) {
        try {
          await addTagToTask(token, created.id, tag.name)
        } catch (e) {
          report.errors.push(`addTagToTask(${created.id}, ${tag.name}): ${String(e)}`)
        }
      }
      next.push({ ...u, clickupId: created.id })
      report.createdRemote++
    } catch (e) {
      report.errors.push(`createTask(${u.name}): ${String(e)}`)
      next.push({ ...u })
    }
  }

  // Phase 4 — pull-down for remote-only tasks
  const linkedCuids = new Set(next.map(t => t.clickupId).filter((x): x is string => !!x))
  for (const r of remote) {
    if (linkedCuids.has(r.id)) continue
    next.push(mapRemoteTask(r, crypto.randomUUID()))
    report.added++
  }

  // Phase 5 — dependencies (additive union)
  // Map clickupId <-> local id (only over tasks that have a clickupId)
  const cuidToLocal = new Map<string, string>()
  const localToCuid = new Map<string, string>()
  for (const t of next) {
    if (t.clickupId) {
      cuidToLocal.set(t.clickupId, t.id)
      localToCuid.set(t.id, t.clickupId)
    }
  }

  // Build local edges from next
  const localEdges = new Set<string>()
  const localPredsByCuid = new Map<string, Set<string>>()
  for (const t of next) {
    const cuid = t.clickupId
    if (!cuid) continue
    const preds = t.dependencies ?? []
    const set = new Set<string>()
    for (const predLocalId of preds) {
      const predCuid = localToCuid.get(predLocalId)
      if (!predCuid) continue
      set.add(predCuid)
      localEdges.add(buildRemoteEdgeKey(cuid, predCuid))
    }
    localPredsByCuid.set(cuid, set)
  }

  // Build remote edges from latest remote view (incl. newly created tasks, which have no deps yet)
  const remoteEdges = new Set<string>()
  const remotePredsByCuid = new Map<string, Set<string>>()
  for (const r of remoteById.values()) {
    const set = new Set<string>()
    for (const dep of r.dependencies ?? []) {
      if (dep.task_id !== r.id) continue
      set.add(dep.depends_on)
      remoteEdges.add(buildRemoteEdgeKey(r.id, dep.depends_on))
    }
    remotePredsByCuid.set(r.id, set)
  }

  // Push local-only edges up
  for (const edge of localEdges) {
    if (remoteEdges.has(edge)) continue
    const [taskCuid, predCuid] = edge.split('->')
    try {
      await addDependency(token, taskCuid, predCuid)
      report.depsAdded++
    } catch (e) {
      report.errors.push(`addDependency(${taskCuid} → ${predCuid}): ${String(e)}`)
    }
  }

  // Pull remote-only edges down — final local deps for each task = union
  for (const t of next) {
    const cuid = t.clickupId
    if (!cuid) continue
    const localPreds = localPredsByCuid.get(cuid) ?? new Set<string>()
    const remotePreds = remotePredsByCuid.get(cuid) ?? new Set<string>()
    const unionPreds = new Set<string>([...localPreds, ...remotePreds])
    let pulledDown = 0
    for (const p of remotePreds) {
      if (!localPreds.has(p)) pulledDown++
    }
    report.depsAddedFromRemote += pulledDown
    // Translate union back to local ids
    const finalLocalPreds: string[] = []
    for (const predCuid of unionPreds) {
      const predLocal = cuidToLocal.get(predCuid)
      if (predLocal) finalLocalPreds.push(predLocal)
    }
    t.dependencies = finalLocalPreds.length ? finalLocalPreds : undefined
  }

  // Phase 6 — commit (new tasks in topological order)
  const existingIds = new Set(localTasks.map(t => t.id))
  const existingTasks = next.filter(t => existingIds.has(t.id))
  const newTasks = next.filter(t => !existingIds.has(t.id))
  setTasks([...existingTasks, ...topoSort(newTasks)])
  report.durationMs = performance.now() - t0
  return report
}
