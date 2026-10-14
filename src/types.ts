export interface Assignee {
  id: number
  username: string
}

export interface Tag {
  name: string
  tag_bg?: string
  tag_fg?: string
}

export type TaskType = 'task' | 'milestone'

export interface GanttTask {
  id: string
  name: string
  // absent means 'task'. A milestone keeps start === end (single date).
  type?: TaskType
  start?: Date
  end?: Date
  progress: number
  dependencies?: string[]
  clickupId?: string
  status?: string
  statusColor?: string
  priority?: 1 | 2 | 3 | 4
  assignees?: Assignee[]
  tags?: Tag[]
  description?: string
  // Pull-only from ClickUp: status.type ('open' | 'custom' | 'closed' | 'done')
  // and the time estimate in ms. Never pushed back.
  statusType?: string
  timeEstimate?: number
}

export interface ClickUpConfig {
  token: string
  teamId: string
  spaceId: string
  folder: string | 'folderless'
  listId: string
  lastSyncAt?: string
}

// Whether the critical path is computed over every task or over the rows the
// current filters leave visible.
export type CriticalScope = 'project' | 'view'

export type FilterType =
  | 'status' | 'tag' | 'assignee' | 'priority' | 'name'
  | 'due' | 'start' | 'deps' | 'unscheduled' | 'overdue'

export interface Filter {
  id: string
  type: FilterType
  op: string
  value: unknown
}

export interface SyncReport {
  added: number
  updatedFromRemote: number
  pushedToRemote: number
  deletedLocal: number
  createdRemote: number
  depsAdded: number
  depsAddedFromRemote: number
  errors: string[]
  durationMs: number
}
