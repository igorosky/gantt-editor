import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuItem } from '../lib/taskMenu'

interface Props {
  x: number // anchor point (viewport)
  y: number
  align?: 'left' | 'right' // which side of the point the menu opens to
  items: MenuItem[]
  onAction: (id: string) => void
  onClose: () => void
  label: string
}

// A menu at a point: the task menu of a row's right-click, its ⋯ button and
// a bar's right-click. Submenus open on hover or Right; Up / Down / Home /
// End move, Enter / Space run, Left / Escape go back. Closes on a click
// outside, any scroll, a resize or blur.
export function ContextMenu({ x, y, align = 'left', items, onAction, onClose, label }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => onCloseRef.current()
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onScroll = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  return (
    <div ref={rootRef} className="ctx-root">
      <MenuList
        items={items}
        x={x}
        y={y}
        align={align}
        label={label}
        onAction={id => { onClose(); onAction(id) }}
        onBack={onClose}
        autoFocus
      />
    </div>
  )
}

function MenuList({ items, x, y, align, label, onAction, onBack, autoFocus }: {
  items: MenuItem[]
  x: number
  y: number
  align: 'left' | 'right'
  label: string
  onAction: (id: string) => void
  onBack: () => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [open, setOpen] = useState<string | null>(null) // submenu id
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const openTimer = useRef<number | undefined>(undefined)

  // Fit the viewport: flip to the other side / upwards when it would overflow
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = align === 'right' ? x - r.width : x
    if (left + r.width > window.innerWidth - 6) left = Math.max(6, x - r.width)
    if (left < 6) left = Math.min(window.innerWidth - r.width - 6, 6)
    let top = y
    if (top + r.height > window.innerHeight - 6) top = Math.max(6, window.innerHeight - r.height - 6)
    setPos({ left, top })
  }, [x, y, align])

  const enabled = items.filter(it => !it.separator && !it.disabledReason)

  useEffect(() => {
    if (autoFocus && pos) itemRefs.current.get(enabled[0]?.id ?? '')?.focus()
  }, [autoFocus, !!pos]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(openTimer.current), [])

  function focusAt(i: number) {
    if (!enabled.length) return
    const n = (i + enabled.length) % enabled.length
    itemRefs.current.get(enabled[n].id)?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const current = enabled.findIndex(it => itemRefs.current.get(it.id) === document.activeElement)
    const it = enabled[current]
    switch (e.key) {
      case 'ArrowDown': focusAt(current + 1); break
      case 'ArrowUp': focusAt(current < 0 ? enabled.length - 1 : current - 1); break
      case 'Home': focusAt(0); break
      case 'End': focusAt(enabled.length - 1); break
      case 'ArrowRight':
        if (it?.children) setOpen(it.id)
        else return
        break
      case 'ArrowLeft':
      case 'Escape':
        onBack()
        break
      case 'Tab':
        onBack()
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  function activate(it: MenuItem) {
    if (it.disabledReason || it.separator) return
    if (it.children) {
      setOpen(o => (o === it.id ? null : it.id))
      return
    }
    onAction(it.id)
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map(it => {
        if (it.separator) return <div key={it.id} className="ctx-menu__sep" role="separator" />
        const disabled = !!it.disabledReason
        return (
          <div key={it.id} className="ctx-menu__cell">
            <button
              ref={el => { if (el) itemRefs.current.set(it.id, el); else itemRefs.current.delete(it.id) }}
              type="button"
              role="menuitem"
              className={`ctx-menu__item${it.danger ? ' ctx-menu__item--danger' : ''}${disabled ? ' ctx-menu__item--disabled' : ''}${open === it.id ? ' ctx-menu__item--open' : ''}`}
              // aria-disabled rather than disabled, so the title explaining why still shows
              aria-disabled={disabled}
              aria-haspopup={it.children ? 'menu' : undefined}
              aria-expanded={it.children ? open === it.id : undefined}
              title={it.disabledReason}
              tabIndex={-1}
              onClick={() => activate(it)}
              onMouseEnter={() => {
                window.clearTimeout(openTimer.current)
                if (disabled) return
                itemRefs.current.get(it.id)?.focus()
                // Submenus follow the pointer after a short pause
                openTimer.current = window.setTimeout(() => setOpen(it.children ? it.id : null), it.children ? 120 : 200)
              }}
            >
              <span className="ctx-menu__check" aria-hidden="true">{it.checked ? '✓' : ''}</span>
              {it.color && <span className="ctx-menu__dot" style={{ background: it.color }} aria-hidden="true" />}
              <span className="ctx-menu__label">{it.label}</span>
              {it.hint && <span className="ctx-menu__hint">{it.hint}</span>}
              {it.children && <span className="ctx-menu__chev" aria-hidden="true">›</span>}
            </button>
            {it.children && open === it.id && (
              <SubMenu
                parent={itemRefs.current.get(it.id)}
                items={it.children}
                label={it.label}
                onAction={onAction}
                onBack={() => { setOpen(null); itemRefs.current.get(it.id)?.focus() }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// A submenu next to its parent item (fixed position, flips left near the edge)
function SubMenu({ parent, items, label, onAction, onBack }: {
  parent: HTMLButtonElement | undefined
  items: MenuItem[]
  label: string
  onAction: (id: string) => void
  onBack: () => void
}) {
  const r = parent?.getBoundingClientRect()
  if (!r) return null
  const goesLeft = r.right + 220 > window.innerWidth
  return (
    <span className="ctx-sub">
      <MenuList
        items={items}
        x={goesLeft ? r.left + 4 : r.right - 4}
        y={r.top - 5}
        align={goesLeft ? 'right' : 'left'}
        label={label}
        onAction={onAction}
        onBack={onBack}
        autoFocus
      />
    </span>
  )
}
