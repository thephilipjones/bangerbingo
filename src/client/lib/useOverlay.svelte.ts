const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function findFirstFocusable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null
  return root.querySelector<HTMLElement>(FOCUSABLE)
}

// Track open overlays so only the topmost handles Escape
const overlayStack: symbol[] = []

export function useOverlay(opts: {
  onClose: () => void
  root: () => HTMLElement | null
  initialFocus?: () => HTMLElement | null
}): void {
  $effect(() => {
    const id = Symbol()
    overlayStack.push(id)

    const returnTo = document.activeElement as HTMLElement | null
    const target = opts.initialFocus?.() ?? findFirstFocusable(opts.root())
    target?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlayStack[overlayStack.length - 1] === id) opts.onClose()
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const idx = overlayStack.lastIndexOf(id)
      if (idx !== -1) overlayStack.splice(idx, 1)
      if (returnTo && document.contains(returnTo)) returnTo.focus()
      else document.body.focus()
    }
  })
}
