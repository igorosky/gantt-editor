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
  // Local id of the parent task; absent means top level
  parentId?: string
  // ClickUp parent id as of the last pull / push: null = top level, absent =
  // never synced with hierarchy. Lets the risk checks tell who moved a task.
  remoteParent?: string | null
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
  // Last successful pull or push (ISO): the baseline the pull / push risk
  // checks compare ClickUp's date_updated against
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

// Pull copies ClickUp onto the board, push copies the board onto ClickUp
export type SyncDirection = 'pull' | 'push'

export type SyncLogKind =
  | 'updated' // fields copied over (pull: board from ClickUp, push: ClickUp from board)
  | 'added' // pull: new board row for a ClickUp-only task
  | 'removed' // pull: deleted in ClickUp, removed from the board
  | 'created' // push: new ClickUp task for a board-only row
  | 'moved' // parent changed
  | 'dep-added'
  | 'dep-removed'
  | 'skipped'
  | 'info'
  | 'error'

// Display strings, oriented in the direction of the copy
export interface SyncFieldChange {
  field: string
  from: string
  to: string
}

export interface SyncLogEntry {
  kind: SyncLogKind
  task?: string // task name
  taskId?: string // local id, when the row is (still) on the board
  clickupId?: string
  changes?: SyncFieldChange[]
  detail?: string
}

// One pull or push, as kept in the sync log
export interface SyncReport {
  id: string
  direction: SyncDirection
  at: string // ISO start time
  durationMs: number
  entries: SyncLogEntry[]
  // Fatal failure (e.g. the fetch); nothing was applied
  aborted?: string
  // Entries dropped to keep the stored log small
  truncated?: number
}
