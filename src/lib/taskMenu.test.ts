import { describe, expect, it } from 'vitest'
import type { GanttTask } from '../types'
import { buildTree, TOP_LEVEL_BLOCKED } from './tree'
import { buildTaskMenu, enabledActions, type MenuContext, type MenuItem } from './taskMenu'

const d = (s: string) => new Date(`${s}T00:00:00`)
const t = (id: string, p: Partial<GanttTask> = {}): GanttTask => ({ id, name: id, progress: 0, ...p })

const tasks = [
  t('a', { start: d('2026-03-02'), end: d('2026-03-06') }),
  t('b', { start: d('2026-03-04'), end: d('2026-03-09'), dependencies: ['a'] }),
  t('p'),
  t('c', { parentId: 'p' }),
  t('g', { parentId: 'c' }),
  t('locked', { parentId: 'p', clickupId: 'cu1', remoteParent: 'cu-p' }),
]

const ctx = (ids: string[], extra: Partial<MenuContext> = {}): MenuContext => ({
  ids, tasks, tree: buildTree(tasks), canAssign: false, dependencyWarnings: true, ...extra,
})

const find = (items: MenuItem[], id: string): MenuItem | undefined => {
  for (const it of items) {
    if (it.id === id) return it
    const sub = it.children && find(it.children, id)
    if (sub) return sub
  }
  return undefined
}

describe('buildTaskMenu: one task', () => {
  it('offers the task actions and rename / open hints', () => {
    const m = buildTaskMenu(ctx(['a']))
    expect(find(m, 'open')?.hint).toBe('Enter')
    expect(find(m, 'rename')?.hint).toBe('F2')
    for (const id of ['add-pred', 'add-succ', 'path-both', 'select-path', 'add-subtask', 'delete', 'priority:1']) {
      expect(enabledActions(m)).toContain(id)
    }
    expect(find(m, 'shift')).toBeUndefined()
  })

  it('path entries follow the dependencies that exist', () => {
    expect(find(buildTaskMenu(ctx(['a'])), 'path-up')?.disabledReason).toBe('No predecessors')
    expect(find(buildTaskMenu(ctx(['b'])), 'path-down')?.disabledReason).toBe('No successors')
    expect(find(buildTaskMenu(ctx(['p'])), 'path')?.disabledReason).toBe('No dependencies')
  })

  it('snap appears only for a late successor with warnings on', () => {
    expect(find(buildTaskMenu(ctx(['b'])), 'snap')).toBeDefined()
    expect(find(buildTaskMenu(ctx(['b'], { dependencyWarnings: false })), 'snap')).toBeUndefined()
    expect(find(buildTaskMenu(ctx(['a'])), 'snap')).toBeUndefined()
  })

  it('hierarchy moves are disabled with a reason where impossible', () => {
    expect(find(buildTaskMenu(ctx(['a'])), 'indent')?.disabledReason).toBeTruthy()
    expect(find(buildTaskMenu(ctx(['b'])), 'indent')?.disabledReason).toBeUndefined()
    expect(find(buildTaskMenu(ctx(['a'])), 'outdent')?.disabledReason).toBe('Already a top-level task')
    expect(find(buildTaskMenu(ctx(['locked'])), 'outdent')?.disabledReason).toBe(TOP_LEVEL_BLOCKED)
    expect(find(buildTaskMenu(ctx(['g'])), 'top-level')?.disabledReason).toBeUndefined()
    expect(find(buildTaskMenu(ctx(['c'])), 'top-level')).toBeUndefined()
  })

  it('names deletion of subtasks', () => {
    expect(find(buildTaskMenu(ctx(['p'])), 'delete')?.label).toBe('Delete with subtasks')
    expect(find(buildTaskMenu(ctx(['a'])), 'delete')?.label).toBe('Delete')
  })

  it('statuses and assign appear only when available, current one checked', () => {
    expect(find(buildTaskMenu(ctx(['a'])), 'status')).toBeUndefined()
    expect(find(buildTaskMenu(ctx(['a'])), 'assign')).toBeUndefined()
    const statuses = [
      { status: 'done', color: '#0f0', orderindex: 2 },
      { status: 'to do', color: '#888', orderindex: 0 },
    ]
    const withStatus = [...tasks.slice(0, 1).map(x => ({ ...x, status: 'To Do' })), ...tasks.slice(1)]
    const m = buildTaskMenu({ ...ctx(['a'], { statuses, canAssign: true }), tasks: withStatus, tree: buildTree(withStatus) })
    expect(find(m, 'status')?.children?.map(c => c.id)).toEqual(['status:to do', 'status:done'])
    expect(find(m, 'status:to do')?.checked).toBe(true)
    expect(find(m, 'assign')).toBeDefined()
  })
})

describe('buildTaskMenu: several tasks', () => {
  it('offers bulk actions instead of single-task ones', () => {
    const m = buildTaskMenu(ctx(['a', 'b']))
    const actions = enabledActions(m)
    expect(actions).toEqual(expect.arrayContaining(['shift', 'chain', 'unlink', 'delete', 'clear-selection', 'path-both']))
    expect(actions).not.toContain('rename')
    expect(find(m, 'delete')?.label).toBe('Delete 2 tasks')
  })

  it('unlink needs a link between the selected tasks', () => {
    expect(find(buildTaskMenu(ctx(['a', 'p'])), 'unlink')?.disabledReason).toBeTruthy()
    expect(find(buildTaskMenu(ctx(['a', 'p', 'c'])), 'delete')?.label).toBe('Delete 3 tasks with subtasks')
  })

  it('ignores ids that no longer exist', () => {
    expect(buildTaskMenu(ctx(['ghost']))).toEqual([])
    expect(find(buildTaskMenu(ctx(['a', 'ghost'])), 'rename')).toBeDefined()
  })
})
