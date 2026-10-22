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
  // Field fingerprints both sides agreed on at the last pull / push (see
  // syncBaseOf in lib/sync.ts): the base of the three-way conflict check.
  // A missing key means unknown; the check then falls back to lastSyncAt.
  syncBase?: SyncBase
}

export type SyncBaseKey =
  | 'name' | 'type' | 'start' | 'end' | 'status' | 'priority'
  | 'assignees' | 'tags' | 'description' | 'deps'

export type SyncBase = Partial<Record<SyncBaseKey, string>>

// A board delete of a subtree holding at least one linked task. Push asks
// whether to delete it in ClickUp too; until then Pull keeps it off the board.
// Snapshot of every removed row (root first, board order), so Restore can put
// them back.
export interface PendingDeletion {
  id: string // root task's local id
  deletedAt: string // ISO
  index: number // root's position in the task array, for Restore
  tasks: GanttTask[]
}

// Connection to ClickUp: the token and the workspace. Which list a board is
// linked to lives on the board (BoardRef), so the portfolio needs only this.
export interface ClickUpConfig {
  token: string
  teamId: string
}

// One board kept in this browser: a local copy of a ClickUp list (listId), or
// a local-only board (no listId). Its tasks, pending deletions and sync log
// are stored under keys suffixed with the id (lib/boards.ts).
export interface BoardRef {
  id: string
  name: string
  listId?: string
  spaceId?: string // the list's space, for its tags
  spaceName?: string
  folderName?: string
  // Last successful pull or push (ISO): the baseline the pull / push risk
  // checks compare ClickUp's date_updated against
  lastSyncAt?: string
  openedAt?: string // ISO, orders the switcher
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
  | 'deleted' // push: deleted on the board, deleted in ClickUp after confirming
  | 'created' // push: new ClickUp task for a board-only row
  | 'moved' // parent changed
  | 'dep-added'
  | 'dep-removed'
  | 'skipped'
  | 'resolved' // conflicts the user decided before the run
  | 'info'
  | 'error'

// Display strings, oriented in the direction of the copy
export interface SyncFieldChange {
  field: string
  from: string
  to: string
}

// How one conflict was decided
export type ResolutionUse = 'board' | 'clickup' | 'merge' | 'edit'

export interface SyncResolvedField {
  field: string
  board: string
  clickup: string
  result: string
  how: ResolutionUse
}

export interface SyncLogEntry {
  kind: SyncLogKind
  task?: string // task name
  taskId?: string // local id, when the row is (still) on the board
  clickupId?: string
  changes?: SyncFieldChange[]
  resolved?: SyncResolvedField[]
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
