import { describe, expect, it } from 'vitest'
import { filterTree, treeRefs, type SpaceNode } from './workspace'

const tree: SpaceNode[] = [
  {
    id: 'S1', name: 'Marketing', groups: [
      { id: 'S1:folderless', lists: [{ id: 'L1', name: 'Inbox' }] },
      { id: 'F1', name: 'Q4', lists: [{ id: 'L2', name: 'Website' }, { id: 'L3', name: 'Ads' }] },
    ],
  },
  { id: 'S2', name: 'Product', groups: [{ id: 'F2', name: 'Apps', lists: [{ id: 'L4', name: 'Mobile' }] }] },
]

describe('workspace tree', () => {
  it('lists every list as a ref with its space and folder', () => {
    const refs = treeRefs(tree)
    expect([...refs.keys()]).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(refs.get('L1')).toEqual({ listId: 'L1', name: 'Inbox', spaceId: 'S1', spaceName: 'Marketing', folderName: undefined })
    expect(refs.get('L2')).toMatchObject({ spaceId: 'S1', folderName: 'Q4' })
    expect(treeRefs(null).size).toBe(0)
  })

  it('filters by list, folder or space name and drops empty branches', () => {
    expect(filterTree(tree, '  ')).toBe(tree)
    expect(treeRefs(filterTree(tree, 'web')).size).toBe(1)
    expect([...treeRefs(filterTree(tree, 'q4')).keys()]).toEqual(['L2', 'L3'])
    expect([...treeRefs(filterTree(tree, 'PRODUCT')).keys()]).toEqual(['L4'])
    expect(filterTree(tree, 'nothing')).toEqual([])
  })
})
