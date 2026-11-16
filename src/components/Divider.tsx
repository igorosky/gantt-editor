import { useCallback } from 'react'

interface Props {
  onResize: (deltaX: number) => void
  onCollapse?: () => void // a knob on the divider hides the left panel
}

export function Divider({ onResize, onCollapse }: Props) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastX = e.clientX

      const onMove = (ev: MouseEvent) => {
        onResize(ev.clientX - lastX)
        lastX = ev.clientX
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [onResize],
  )

  return (
    <div
      className="divider"
      onMouseDown={handleMouseDown}
      aria-label="Resize panels"
    >
      {onCollapse && (
        <button
          type="button"
          className="divider__collapse"
          onMouseDown={e => e.stopPropagation()}
          onClick={onCollapse}
          aria-label="Hide the task list"
          title="Hide the task list (\)"
        >
          ‹
        </button>
      )}
    </div>
  )
}
