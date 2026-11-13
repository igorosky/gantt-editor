// Which tasks are selected on the board. Pure: the board keeps one Selection
// in state and replaces it through these functions. `anchor` is where a
// Shift+click range starts (the last plain or Ctrl click).

export interface Selection {
  ids: ReadonlySet<string>
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null }

export interface ClickMods {
  shift?: boolean
  toggle?: boolean // Ctrl on Windows / Linux, Cmd on macOS
}

export function selectOnly(id: string): Selection {
  return { ids: new Set([id]), anchor: id }
}

export function toggle(sel: Selection, id: string): Selection {
  const ids = new Set(sel.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ids, anchor: id }
}

// Every id between the anchor and `id` in display order; with `add` the range
// joins the current selection (Ctrl+Shift). No anchor in `order` = just `id`.
export function range(sel: Selection, order: readonly string[], id: string, add = false): Selection {
  const to = order.indexOf(id)
  const from = sel.anchor ? order.indexOf(sel.anchor) : -1
  if (to < 0) return sel
  if (from < 0) return { ids: new Set(add ? [...sel.ids, id] : [id]), anchor: id }
  const [a, b] = from <= to ? [from, to] : [to, from]
  const ids = new Set(add ? sel.ids : [])
  for (let i = a; i <= b; i++) ids.add(order[i])
  // The anchor stays, so the next Shift+click measures from the same row
  return { ids, anchor: sel.anchor }
}

// A click with its modifiers
export function click(sel: Selection, order: readonly string[], id: string, mods: ClickMods = {}): Selection {
  if (mods.shift) return range(sel, order, id, !!mods.toggle)
  if (mods.toggle) return toggle(sel, id)
  return selectOnly(id)
}

// The row a step of the arrow keys lands on: the one after (or before) the
// current focus, which is the anchor's range end. Nothing selected = first /
// last row. With `extend` the range from the anchor grows (Shift+arrow).
export function step(
  sel: Selection, order: readonly string[], dir: 1 | -1, extend = false, focus?: string | null,
): Selection {
  if (!order.length) return sel
  const cur = focus ?? lastInOrder(sel, order)
  const i = cur ? order.indexOf(cur) : -1
  const next = i < 0
    ? order[dir === 1 ? 0 : order.length - 1]
    : order[Math.min(order.length - 1, Math.max(0, i + dir))]
  if (!extend) return selectOnly(next)
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : next
  return { ...range({ ids: sel.ids, anchor }, order, next), anchor }
}

// The selected row furthest from the anchor (the moving end of a Shift range)
export function lastInOrder(sel: Selection, order: readonly string[]): string | null {
  if (!sel.ids.size) return null
  const idx = order.map((id, i) => (sel.ids.has(id) ? i : -1)).filter(i => i >= 0)
  if (!idx.length) return null
  const a = sel.anchor ? order.indexOf(sel.anchor) : -1
  if (a < 0) return order[idx[idx.length - 1]]
  const far = idx.reduce((best, i) => (Math.abs(i - a) > Math.abs(best - a) ? i : best), idx[0])
  return order[far]
}

// Drops ids that no longer exist; returns the same object when nothing changed
export function prune(sel: Selection, exists: (id: string) => boolean): Selection {
  let changed = false
  const ids = new Set<string>()
  for (const id of sel.ids) {
    if (exists(id)) ids.add(id)
    else changed = true
  }
  const anchor = sel.anchor && exists(sel.anchor) ? sel.anchor : null
  if (!changed && anchor === sel.anchor) return sel
  return { ids, anchor }
}

// The selected ids in display order (ids not shown come last, in set order)
export function inOrder(sel: Selection, order: readonly string[]): string[] {
  const shown = order.filter(id => sel.ids.has(id))
  const rest = [...sel.ids].filter(id => !shown.includes(id))
  return [...shown, ...rest]
}
