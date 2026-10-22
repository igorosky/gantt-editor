// The workspace as Space > Folder > List, for the board switcher and the
// portfolio's project picker. Loading only issues GET requests.

import { listFolderlessLists, listFolders, listLists, listSpaces, type List } from './clickup'
import type { ProjectRef } from './portfolioData'

export interface SpaceNode {
  id: string
  name: string
  groups: Array<{ id: string; name?: string; lists: List[] }> // name undefined = folderless
}

export async function loadWorkspaceTree(token: string, teamId: string): Promise<SpaceNode[]> {
  const spaces = await listSpaces(token, teamId)
  return Promise.all(spaces.map(async (s): Promise<SpaceNode> => {
    const [folders, folderless] = await Promise.all([listFolders(token, s.id), listFolderlessLists(token, s.id)])
    const groups: SpaceNode['groups'] = await Promise.all(folders.map(async f => ({
      id: f.id, name: f.name as string | undefined, lists: f.lists ?? await listLists(token, f.id),
    })))
    if (folderless.length) groups.unshift({ id: `${s.id}:folderless`, name: undefined, lists: folderless })
    return { id: s.id, name: s.name, groups }
  }))
}

// Every list in the tree as a ProjectRef, in tree order
export function treeRefs(tree: SpaceNode[] | null): Map<string, ProjectRef> {
  const out = new Map<string, ProjectRef>()
  for (const s of tree ?? []) for (const g of s.groups) for (const l of g.lists) {
    out.set(l.id, { listId: l.id, name: l.name, spaceId: s.id, spaceName: s.name, folderName: g.name })
  }
  return out
}

// Lists whose name, folder or space contains the query (case-insensitive);
// empty groups and spaces dropped. A blank query returns the tree itself.
export function filterTree(tree: SpaceNode[], query: string): SpaceNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return tree
  return tree.map(s => ({
    ...s,
    groups: s.groups.map(g => ({
      ...g,
      lists: g.lists.filter(l => [l.name, g.name ?? '', s.name].some(t => t.toLowerCase().includes(q))),
    })).filter(g => g.lists.length),
  })).filter(s => s.groups.length)
}
