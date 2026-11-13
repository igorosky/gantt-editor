// The task under the pointer, mirrored between its row and its bar. Done on
// the DOM (a class on both elements), not in React state, so moving over a
// long list never re-renders it.

let current: string | null = null

function mark(id: string | null, on: boolean) {
  if (!id || typeof document === 'undefined') return
  const q = CSS.escape(id)
  document
    .querySelectorAll(`.task-row[data-task-id="${q}"], .bar-wrapper[data-id="${q}"]`)
    .forEach(el => el.classList.toggle('is-hover', on))
}

export function setHover(id: string | null) {
  if (id === current) return
  mark(current, false)
  current = id
  mark(id, true)
}

// After a render rebuilt the bars
export function reapplyHover() {
  mark(current, true)
}

// A short highlight on a task's row and bar (a new task, a jump)
export function flashTask(id: string) {
  if (typeof document === 'undefined') return
  const q = CSS.escape(id)
  document
    .querySelectorAll(`.task-row[data-task-id="${q}"], .bar-wrapper[data-id="${q}"]`)
    .forEach(el => {
      el.classList.remove('is-flash')
      void (el as HTMLElement).getBoundingClientRect() // restart the animation
      el.classList.add('is-flash')
      window.setTimeout(() => el.classList.remove('is-flash'), 1500)
    })
}
