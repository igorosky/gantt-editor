import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteTask } from './clickup'
import { mapRemoteTask } from './sync'
import {
  deserializeCache, fetchProjects, projectColor, serializeCache, toPortfolioTask, withParentNames, OTHER_COLOR,
} from './portfolioData'

function remote(p: Partial<RemoteTask>): RemoteTask {
  return {
    id: 'cu1', name: 'Remote', start_date: null, due_date: null, date_updated: '0',
    dependencies: [], ...p,
  }
}

const MS = (y: number, m: number, d: number) => String(new Date(y, m - 1, d).getTime())

describe('mapRemoteTask', () => {
  it('pulls status type and time estimate', () => {
    const t = mapRemoteTask(remote({
      start_date: MS(2026, 10, 1), due_date: MS(2026, 10, 5),
      status: { status: 'complete', color: '#080', type: 'done' },
      time_estimate: 7200000,
    }), 'local-1')
    expect(t).toMatchObject({
      id: 'local-1', clickupId: 'cu1', type: 'task', status: 'complete',
      statusType: 'done', timeEstimate: 7200000,
    })
    expect(t.start).toEqual(new Date(2026, 9, 1))
  })

  it('collapses a milestone onto its due date and ignores empty estimates', () => {
    const t = mapRemoteTask(remote({
      custom_item_id: 1, start_date: MS(2026, 10, 1), due_date: MS(2026, 10, 9), time_estimate: 0,
    }), 'x')
    expect(t.type).toBe('milestone')
    expect(t.start).toEqual(new Date(2026, 9, 9))
    expect(t.end).toEqual(new Date(2026, 9, 9))
    expect(t.timeEstimate).toBeUndefined()
  })
})

describe('portfolio tasks and cache', () => {
  it('computes warnings, then drops the description', () => {
    const t = toPortfolioTask(remote({ description: 'Build it' }), 'L1')
    expect(t).toMatchObject({ id: 'cu1', projectId: 'L1', warningIds: ['missing-dod'] })
    expect('description' in t).toBe(false)
    expect(toPortfolioTask(remote({ description: 'DoD: shipped' }), 'L1').warningIds).toEqual([])
  })

  it('checks the DoD with the configured keywords', () => {
    const kw = ['Kryteria ukończenia']
    expect(toPortfolioTask(remote({ description: 'Kryteria ukończenia: działa' }), 'L1', kw).warningIds).toEqual([])
    expect(toPortfolioTask(remote({ description: 'DoD: shipped' }), 'L1', kw).warningIds).toEqual(['missing-dod'])
    expect(toPortfolioTask(remote({}), 'L1', kw).warningIds).toEqual(['empty-description'])
  })

  it('round-trips through JSON with real dates', () => {
    const t = toPortfolioTask(remote({ due_date: MS(2026, 10, 5), time_estimate: 3600000 }), 'L1')
    const back = deserializeCache(serializeCache({ L1: { fetchedAt: 'now', tasks: [t] } }))
    expect(back.L1.tasks[0].end).toBeInstanceOf(Date)
    expect(back.L1.tasks[0]).toEqual(t)
  })

  it('keeps the ClickUp parent and names it within the project', () => {
    const tasks = withParentNames([
      toPortfolioTask(remote({ id: 'p', name: 'Parent' }), 'L1'),
      toPortfolioTask(remote({ id: 'c', name: 'Review', parent: 'p' }), 'L1'),
      toPortfolioTask(remote({ id: 'o', name: 'Orphan', parent: 'elsewhere' }), 'L1'),
    ])
    expect(tasks.map(t => [t.parentId, t.parentName])).toEqual([
      [undefined, undefined], ['p', 'Parent'], ['elsewhere', undefined],
    ])
  })

  it('keeps the predecessors only, and they survive the cache', () => {
    const t = toPortfolioTask(remote({
      id: 'b',
      dependencies: [
        { task_id: 'b', depends_on: 'a', type: 1 },
        { task_id: 'c', depends_on: 'b', type: 1 }, // b is c's predecessor, not the other way
      ],
    }), 'L1')
    expect(t.dependencies).toEqual(['a'])
    expect(toPortfolioTask(remote({ id: 'x' }), 'L1').dependencies).toBeUndefined()
    const back = deserializeCache(serializeCache({ L1: { tasks: [t] } }))
    expect(back.L1.tasks[0].dependencies).toEqual(['a'])
  })

  it('colors projects in fixed slots, then neutral', () => {
    expect(projectColor(0)).toBe('#2a78d6')
    expect(projectColor(8)).toBe(OTHER_COLOR)
  })
})

describe('fetchProjects', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches lists independently and only with GET', async () => {
    const calls: Array<{ url: string; method: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      if (url.includes('/list/bad/')) {
        return new Response(JSON.stringify({ err: 'Rate limit reached' }), { status: 429 })
      }
      return new Response(JSON.stringify({
        tasks: [remote({ id: 'a', list: { id: 'good', name: 'Good list' } })],
      }), { status: 200 })
    }))
    const progress: number[] = []
    const out = await fetchProjects('pk_x', ['good', 'bad'], done => progress.push(done))
    expect(out.good.tasks?.map(t => t.id)).toEqual(['a'])
    expect(out.good.listName).toBe('Good list')
    expect(out.bad.error).toBe('Rate limit reached')
    expect(calls.every(c => c.method === 'GET')).toBe(true)
    expect(progress).toEqual([0, 1, 2])
  })
})
