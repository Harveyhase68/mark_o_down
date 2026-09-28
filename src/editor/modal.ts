// The one modal frame every dialog uses: backdrop, Esc, click outside and –
// most importantly – a locked background. Everything behind the dialog is made
// `inert`, so Tab can't move the focus into the editor behind it (typing blind
// into the document), clicks don't reach it and screen readers skip it.
// Modals can be stacked (the config editor opens over the image picker).

export interface ModalOptions {
  /** Accessible name of the dialog. */
  label: string
  /** Esc and click on the backdrop. Default: just close. */
  onCancel?: () => void
  /** Click outside closes (default true). */
  closeOnBackdrop?: boolean
}

export interface Modal {
  backdrop: HTMLElement
  close(): void
}

interface Layer {
  backdrop: HTMLElement
  /** Elements this layer made inert (restored on close). */
  inerted: HTMLElement[]
  returnFocus: HTMLElement | null
  onKey: (e: KeyboardEvent) => void
}

const stack: Layer[] = []

/** Is any modal open? (Global shortcuts and background checks stay quiet then.) */
export const modalOpen = () => stack.length > 0

export function openModal(content: HTMLElement, opts: ModalOptions): Modal {
  const backdrop = document.createElement('div')
  backdrop.className = 'dialog-backdrop'
  content.setAttribute('role', content.getAttribute('role') ?? 'dialog')
  content.setAttribute('aria-modal', 'true')
  content.setAttribute('aria-label', opts.label)
  backdrop.append(content)

  // lock everything else: the page and lower modals
  const inerted = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.inert)
  for (const el of inerted) el.inert = true
  document.body.append(backdrop)

  const cancel = () => (opts.onCancel ? opts.onCancel() : modal.close())
  const onKey = (e: KeyboardEvent) => {
    if (stack[stack.length - 1]?.backdrop !== backdrop) return // only the top modal reacts
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (e.key === 'Tab') trapTab(e, content)
  }
  document.addEventListener('keydown', onKey, true)
  if (opts.closeOnBackdrop !== false) backdrop.addEventListener('mousedown', (e) => e.target === backdrop && cancel())

  const layer: Layer = { backdrop, inerted, returnFocus: document.activeElement as HTMLElement | null, onKey }
  stack.push(layer)

  let closed = false
  const modal: Modal = {
    backdrop,
    close() {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      backdrop.remove()
      stack.splice(stack.indexOf(layer), 1)
      for (const el of inerted) el.inert = false
      // back to where the user was (the editor, the lower dialog …); if that element
      // is gone (e.g. redrawn), into the dialog below
      const back = layer.returnFocus
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true })
      else {
        const below = stack[stack.length - 1]?.backdrop
        if (below) focusables(below)[0]?.focus()
      }
    },
  }

  // focus the first sensible control (autofocus, else first field, else primary button)
  queueMicrotask(() => {
    if (content.contains(document.activeElement)) return
    const target =
      content.querySelector<HTMLElement>('[autofocus]') ??
      content.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ??
      content.querySelector<HTMLElement>('button.primary') ??
      focusables(content)[0]
    target?.focus()
  })
  return modal
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  // tabIndex < 0: reachable by arrow keys only (e.g. tiles in a grid), not by Tab
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden]') && el.offsetParent !== null)
}

/** Tab / Shift+Tab cycle inside the dialog. */
function trapTab(e: KeyboardEvent, content: HTMLElement) {
  const items = focusables(content)
  if (!items.length) return e.preventDefault()
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && (active === first || !content.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !content.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
