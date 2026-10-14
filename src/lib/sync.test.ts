import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClickUpConfig, GanttTask, SyncReport } from '../types'
import type { RemoteTask } from './clickup'
import { syncWithClickUp } from './sync'

const CONFIG: ClickUpConfig = {
  token: 'pk_test', teamId: 'T', spaceId: 'S', folder: 'folderless', listId: 'L',
  lastSyncAt: new Date(2026, 9, 10).toISOString(),
}
const BEFORE_SYNC = String(new Date(2026, 9, 1).getTime())
const AFTER_SYNC = String(new Date(2026, 9, 12).getTime())

function remote(id: string, p: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id, name: id, start_date: null, due_date: null, date_updated: BEFORE_SYNC,
    dependencies: [], parent: null, ...p,
  }
}

// Named like its remote twin, so only the hierarchy differs
function local(id: string, p: Partial<GanttTask> = {}): GanttTask {
  return { id, name: p.clickupId ?? id, progress: 0, ...p }
}

interface Call { method: string; path: string; body?: Record<string, unknown> }

// Serves the remote list and records every write
function stubClickUp(remoteTasks: RemoteTask[]): Call[] {
  const calls: Call[] = []
  let created = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace(/^\/clickup/, '').split('?')[0]
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : undefined
    calls.push({ method, path, body })
    if (method === 'GET') return new Response(JSON.stringify({ tasks: remoteTasks }), { status: 200 })
    if (method === 'POST' && path === '/list/L/task') {
      // ClickUp's create response; the parent is left out on purpose
      return new Response(JSON.stringify(remote(`new${++created}`, { name: String(body?.name) })), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }))
  return calls
}

async function run(tasks: GanttTask[]): Promise<{ next: GanttTask[]; report: SyncReport }> {
  let next: GanttTask[] = []
  const report = await syncWithClickUp(CONFIG, tasks, t => { next = t })
  return { next, report }
}

const byName = (tasks: GanttTask[], name: string) => tasks.find(t => t.name === name)!

describe('syncWithClickUp: hierarchy', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('adopts ClickUp nesting on the first sync of pre-subtask data, without writing', async () => {
    const calls = stubClickUp([remote('P'), remote('C', { parent: 'P' })])
    const { next } = await run([local('p', { clickupId: 'P' }), local('c', { clickupId: 'C' })])
    expect(byName(next, 'C')).toMatchObject({ parentId: 'p', remoteParent: 'P' })
    expect(byName(next, 'P')).toMatchObject({ parentId: undefined, remoteParent: null })
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('pushes a local re-parent', async () => {
    const calls = stubClickUp([remote('P1'), remote('P2'), remote('C', { parent: 'P1' })])
    const { next, report } = await run([
      local('p1', { clickupId: 'P1', remoteParent: null }),
      local('p2', { clickupId: 'P2', remoteParent: null }),
      local('c', { clickupId: 'C', parentId: 'p2', remoteParent: 'P1' }),
    ])
    expect(calls).toContainEqual({ method: 'PUT', path: '/task/C', body: { parent: 'P2' } })
    expect(byName(next, 'C')).toMatchObject({ parentId: 'p2', remoteParent: 'P2' })
    expect(report.errors).toEqual([])
  })

  it('lets a move made in ClickUp win', async () => {
    const calls = stubClickUp([remote('P1'), remote('P2'), remote('C', { parent: 'P2', date_updated: AFTER_SYNC })])
    const { next } = await run([
      local('p1', { clickupId: 'P1', remoteParent: null }),
      local('p2', { clickupId: 'P2', remoteParent: null }),
      local('c', { clickupId: 'C', parentId: 'p1', remoteParent: 'P1' }),
    ])
    expect(byName(next, 'C')).toMatchObject({ parentId: 'p2', remoteParent: 'P2' })
    expect(calls.some(c => c.body && 'parent' in c.body)).toBe(false)
  })

  it('creates a new parent before its new subtask', async () => {
    const calls = stubClickUp([])
    const { next } = await run([
      local('m', { name: 'Child', parentId: 'n' }),
      local('n', { name: 'Parent' }),
    ])
    const posts = calls.filter(c => c.method === 'POST')
    expect(posts.map(c => c.body?.name)).toEqual(['Parent', 'Child'])
    expect(posts[1].body?.parent).toBe('new1')
    expect(byName(next, 'Child')).toMatchObject({ clickupId: 'new2', parentId: 'n', remoteParent: 'new1' })
    expect(calls.filter(c => c.method === 'PUT')).toEqual([])
  })

  it('never sends a null parent; a local un-nesting is reported instead', async () => {
    const calls = stubClickUp([remote('P'), remote('C', { parent: 'P' })])
    const { next, report } = await run([
      local('p', { clickupId: 'P', remoteParent: null }),
      local('c', { clickupId: 'C', remoteParent: 'P' }),
    ])
    expect(calls.some(c => c.body && 'parent' in c.body)).toBe(false)
    expect(report.errors).toHaveLength(1)
    expect(byName(next, 'C').parentId).toBeUndefined()
  })

  it('pulls remote-only subtasks nested', async () => {
    stubClickUp([remote('P'), remote('C', { parent: 'P' }), remote('G', { parent: 'C' })])
    const { next } = await run([])
    const p = byName(next, 'P')
    const c = byName(next, 'C')
    expect(c.parentId).toBe(p.id)
    expect(byName(next, 'G').parentId).toBe(c.id)
  })

  it('keeps a subtask whose parent lives in another list at the top level, untouched', async () => {
    const calls = stubClickUp([remote('C', { parent: 'ELSEWHERE' })])
    const first = await run([local('c', { clickupId: 'C' })])
    expect(byName(first.next, 'C')).toMatchObject({ parentId: undefined, remoteParent: 'ELSEWHERE' })
    const second = await run(first.next)
    expect(second.report.errors).toEqual([])
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })
})
