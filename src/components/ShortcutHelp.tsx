import { useEffect, useRef } from 'react'

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Select',
    rows: [
      ['Click', 'Select a task (row or bar)'],
      ['Shift + Click', 'Select a range'],
      ['Ctrl / Cmd + Click', 'Add or remove one task'],
      ['↑ ↓', 'Previous / next task'],
      ['Shift + ↑ ↓', 'Grow the selection'],
      ['← →', 'Collapse / expand, go to parent / first subtask'],
      ['Esc', 'Clear the highlighted path, then the selection'],
    ],
  },
  {
    title: 'Act',
    rows: [
      ['Enter / double-click bar', 'Open details'],
      ['F2 / double-click name', 'Rename'],
      ['Right-click / ⋯', 'Task menu (acts on the selection)'],
      ['Delete', 'Delete the selected tasks'],
      ['P', 'Highlight the path of the selection'],
      ['Drag the dot after a bar', 'Link it to another task'],
    ],
  },
  {
    title: 'Board',
    rows: [
      ['Ctrl / Cmd + K', 'Find a task'],
      ['Ctrl / Cmd + Z', 'Undo'],
      ['Ctrl / Cmd + Y', 'Redo'],
      ['\\', 'Hide / show the task list'],
      ['?', 'This list'],
    ],
  },
]

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="clickup-modal-overlay" onClick={onClose}>
      <div
        className="clickup-modal shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); onClose() }
        }}
      >
        <h2 className="clickup-modal__title">Keyboard shortcuts</h2>
        <div className="shortcuts__grid">
          {GROUPS.map(g => (
            <section key={g.title} className="shortcuts__group">
              <h3 className="settings__heading">{g.title}</h3>
              <dl>
                {g.rows.map(([k, v]) => (
                  <div key={k} className="shortcuts__row">
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="clickup-modal__actions">
          <button ref={ref} type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
