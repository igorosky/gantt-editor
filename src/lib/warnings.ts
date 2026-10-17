import type { GanttTask } from '../types'
import { DEFAULT_SETTINGS, dodPattern, isBacklog, type Settings } from './settings'

export type WarningId = 'empty-description' | 'missing-dod' | 'missing-priority'

export interface TaskWarning {
  id: WarningId
  message: string
}

const MESSAGES: Record<WarningId, string> = {
  'empty-description': 'Task has no description',
  'missing-dod': 'Description is missing Definition of Done (DoD)',
  'missing-priority': 'Task has no priority',
}

// What the description says, independent of which warnings are switched on:
// empty (which also means no DoD), no DoD phrase, or fine. Portfolio caches
// keep these ids, since they drop the description.
export function contentWarningIds(task: GanttTask, dodKeywords: string[]): WarningId[] {
  const desc = task.description?.trim() ?? ''
  if (!desc) return ['empty-description']
  return dodPattern(dodKeywords).test(desc) ? [] : ['missing-dod']
}

// The warnings the settings switch on, given the task's contentWarningIds
export function applyWarningSettings(
  contentIds: readonly string[], task: GanttTask, s: Settings = DEFAULT_SETTINGS,
): TaskWarning[] {
  if (!s.backlog.include.warnings && isBacklog(task, s)) return []
  const w = s.warnings
  const empty = contentIds.includes('empty-description')
  const ids: WarningId[] = []
  // An empty description says the DoD is missing too, so it is reported as
  // such when only the description warning is switched off
  if (empty && w.emptyDescription) ids.push('empty-description')
  else if ((empty || contentIds.includes('missing-dod')) && w.missingDod) ids.push('missing-dod')
  if (w.missingPriority && !task.priority) ids.push('missing-priority')
  return ids.map(id => ({ id, message: MESSAGES[id] }))
}

export function getTaskWarnings(task: GanttTask, s: Settings = DEFAULT_SETTINGS): TaskWarning[] {
  return applyWarningSettings(contentWarningIds(task, s.warnings.dodKeywords), task, s)
}
