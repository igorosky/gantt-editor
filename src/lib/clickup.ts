import type { Tag } from '../types'

const BASE = '/clickup'

export interface Team {
  id: string
  name: string
}

export interface Space {
  id: string
  name: string
}

export interface Folder {
  id: string
  name: string
  // GET /space/{id}/folder embeds each folder's lists
  lists?: List[]
}

export interface List {
  id: string
  name: string
}

// ClickUp custom task type id of the built-in "Milestone" type.
// null / absent custom_item_id means a plain task.
export const MILESTONE_ITEM_ID = 1

export interface RemoteTask {
  id: string
  name: string
  custom_item_id?: number | null
  start_date: string | null
  due_date: string | null
  date_updated: string
  dependencies: Array<{ task_id: string; depends_on: string; type: number }>
  status?: { status: string; color?: string; type?: string }
  priority?: { orderindex?: string }
  assignees?: Array<{ id: number; username: string }>
  tags?: Array<{ name: string; tag_bg?: string; tag_fg?: string }>
  description?: string
  time_estimate?: number | null
  list?: { id: string; name: string }
  // Parent task id for a subtask, null for a top-level task
  parent?: string | null
}

export interface TeamMember {
  id: number
  username: string | null
  email: string
  profilePicture?: string
}

export interface CreateTaskBody {
  name: string
  custom_item_id?: number | null
  start_date?: string
  due_date?: string
  start_date_time?: boolean
  due_date_time?: boolean
  priority?: number
  description?: string
  assignees?: number[]
  // Creates a subtask; the parent must live in the same list
  parent?: string
}

export interface UpdateTaskBody extends Omit<CreateTaskBody, 'assignees' | 'start_date' | 'due_date'> {
  start_date?: string | null
  due_date?: string | null
  assignees?: { add?: number[]; rem?: number[] }
  status?: string
  // Moves the task under another parent. ClickUp rejects null: a subtask
  // cannot be turned back into a top-level task through the API.
  parent?: string
}

export interface ClickUpStatus {
  status: string
  color: string
  orderindex: number
  type?: string
}

export class ClickUpError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg)
    this.name = 'ClickUpError'
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const err = (body as { err?: string; error?: string }) ?? {}
    const msg = err.err || err.error || `${res.status} ${res.statusText}`
    throw new ClickUpError(res.status, body, msg)
  }
  return body as T
}

export const toClickUpDate = (d: Date): string => String(d.getTime())

export const fromClickUpDate = (s: string | null): Date | null =>
  s ? new Date(Number(s)) : null

export async function listTeams(token: string): Promise<Team[]> {
  const r = await request<{ teams: Team[] }>(token, '/team')
  return r.teams
}

export async function listSpaces(token: string, teamId: string): Promise<Space[]> {
  const r = await request<{ spaces: Space[] }>(token, `/team/${teamId}/space`)
  return r.spaces
}

export async function listFolders(token: string, spaceId: string): Promise<Folder[]> {
  const r = await request<{ folders: Folder[] }>(token, `/space/${spaceId}/folder`)
  return r.folders
}

export async function listFolderlessLists(token: string, spaceId: string): Promise<List[]> {
  const r = await request<{ lists: List[] }>(token, `/space/${spaceId}/list`)
  return r.lists
}

export async function listLists(token: string, folderId: string): Promise<List[]> {
  const r = await request<{ lists: List[] }>(token, `/folder/${folderId}/list`)
  return r.lists
}

export async function getAllTasks(token: string, listId: string): Promise<RemoteTask[]> {
  const out: RemoteTask[] = []
  let page = 0
  while (true) {
    const r = await request<{ tasks: RemoteTask[] }>(
      token,
      `/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`,
    )
    out.push(...r.tasks)
    if (r.tasks.length < 100) break
    page++
  }
  return out
}

export async function createTask(
  token: string,
  listId: string,
  body: CreateTaskBody,
): Promise<RemoteTask> {
  return request<RemoteTask>(token, `/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateTask(
  token: string,
  taskId: string,
  body: Partial<UpdateTaskBody>,
): Promise<RemoteTask> {
  return request<RemoteTask>(token, `/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function getListStatuses(token: string, listId: string): Promise<ClickUpStatus[]> {
  const r = await request<{ statuses: ClickUpStatus[] }>(token, `/list/${listId}`)
  return r.statuses ?? []
}

export async function listTeamMembers(token: string, teamId: string): Promise<TeamMember[]> {
  const r = await request<{ teams: Array<{ id: string; members: Array<{ user: TeamMember }> }> }>(token, '/team')
  const team = r.teams.find(t => t.id === teamId)
  return team?.members.map(m => m.user) ?? []
}

export async function getSpaceTags(token: string, spaceId: string): Promise<Tag[]> {
  const r = await request<{ tags: Tag[] }>(token, `/space/${spaceId}/tag`)
  return r.tags ?? []
}

export async function addTagToTask(token: string, taskId: string, tagName: string): Promise<void> {
  await request<unknown>(token, `/task/${taskId}/tag/${encodeURIComponent(tagName)}`, { method: 'POST' })
}

export async function removeTagFromTask(token: string, taskId: string, tagName: string): Promise<void> {
  await request<unknown>(token, `/task/${taskId}/tag/${encodeURIComponent(tagName)}`, { method: 'DELETE' })
}

export async function addDependency(
  token: string,
  taskId: string,
  dependsOn: string,
): Promise<void> {
  await request<unknown>(token, `/task/${taskId}/dependency`, {
    method: 'POST',
    body: JSON.stringify({ depends_on: dependsOn }),
  })
}

export async function removeDependency(
  token: string,
  taskId: string,
  dependsOn: string,
): Promise<void> {
  await request<unknown>(
    token,
    `/task/${taskId}/dependency?depends_on=${encodeURIComponent(dependsOn)}&dependency_of=${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
}
