// Which element a keyboard shortcut must leave alone.

// Text entry: every shortcut is left to the field (Ctrl+Z is its own undo)
export function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type)
}

// Buttons and links act on Enter / Space themselves
export function isActivationTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  return el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button'
    || el.getAttribute('role') === 'menuitem' || (el.tagName === 'INPUT' && !isTypingTarget(el))
}

// Ctrl on Windows / Linux, Cmd on macOS
export const modKey = (e: { ctrlKey: boolean; metaKey: boolean }): boolean => e.ctrlKey || e.metaKey
