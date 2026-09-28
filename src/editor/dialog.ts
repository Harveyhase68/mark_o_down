// Tiny modal form (link / image / raw Markdown editing).

import { openModal } from './modal'

export interface Field {
  name: string
  label: string
  value?: string
  multiline?: boolean
  placeholder?: string
}

export interface DialogButton {
  label: string
  value: string
  primary?: boolean
  danger?: boolean
}

export interface DialogResult {
  action: string
  values: Record<string, string>
}

export function openDialog(opts: {
  title: string
  /** Explanatory text below the title (plain text, line breaks kept). */
  message?: string
  fields: Field[]
  buttons?: DialogButton[]
  extra?: (form: HTMLFormElement, set: (name: string, value: string) => void) => void
}): Promise<DialogResult | null> {
  const buttons = opts.buttons ?? [
    { label: 'Abbrechen', value: 'cancel' },
    { label: 'OK', value: 'ok', primary: true },
  ]
  return new Promise((resolve) => {
    const form = document.createElement('form')
    form.className = 'dialog'
    form.innerHTML = `<h2></h2><p class="message"></p><div class="fields"></div><div class="extra"></div><div class="buttons"></div>`
    form.querySelector('h2')!.textContent = opts.title
    const message = form.querySelector<HTMLElement>('.message')!
    if (opts.message) message.textContent = opts.message
    else message.remove()

    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
    for (const f of opts.fields) {
      const label = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = f.label
      const input = f.multiline ? document.createElement('textarea') : document.createElement('input')
      input.name = f.name
      input.value = f.value ?? ''
      input.placeholder = f.placeholder ?? ''
      input.spellcheck = false
      if (input instanceof HTMLTextAreaElement) input.rows = 6
      label.append(span, input)
      form.querySelector('.fields')!.append(label)
      inputs.set(f.name, input)
    }

    let action = 'cancel'
    for (const b of buttons) {
      const btn = document.createElement('button')
      btn.type = b.value === 'cancel' ? 'button' : 'submit'
      btn.textContent = b.label
      if (b.primary) btn.classList.add('primary')
      if (b.danger) btn.classList.add('danger')
      btn.addEventListener('click', () => {
        action = b.value
        if (b.value === 'cancel') close(null)
      })
      form.querySelector('.buttons')!.append(btn)
    }

    opts.extra?.(form.querySelector('.extra') as HTMLFormElement, (name, value) => {
      const input = inputs.get(name)
      if (input) input.value = value
    })

    const values = () => Object.fromEntries([...inputs].map(([k, v]) => [k, v.value]))
    const close = (result: DialogResult | null) => {
      modal.close()
      resolve(result)
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      close({ action: action === 'cancel' ? 'ok' : action, values: values() })
    })
    // Ctrl+Enter submits multi-line fields
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit()
    })

    form.className = 'dialog'
    const modal = openModal(form, { label: opts.title, onCancel: () => close(null) })
    const first = inputs.values().next().value
    if (first) {
      first.focus()
      if (first instanceof HTMLInputElement) first.select()
    }
  })
}

// ------------------------------------------------------------------ popup menu

export type MenuItem = { label: string; shortcut?: string; title?: string; disabled?: boolean; run: () => void } | 'separator'

let openMenuState: { anchor: HTMLElement; close: () => void } | null = null

/** Small dropdown menu below `anchor`; toggles on the anchor, closes on click outside or Escape. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]) {
  if (openMenuState) {
    const same = openMenuState.anchor === anchor
    openMenuState.close()
    if (same) return
  }
  const menu = document.createElement('div')
  menu.className = 'popup-menu'
  menu.setAttribute('role', 'menu')
  for (const item of items) {
    if (item === 'separator') {
      menu.append(Object.assign(document.createElement('hr'), { role: 'separator' }))
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.innerHTML = '<span></span><kbd></kbd>'
    btn.querySelector('span')!.textContent = item.label
    btn.querySelector('kbd')!.textContent = item.shortcut ?? ''
    if (item.title) btn.title = item.title
    btn.disabled = !!item.disabled
    btn.onmousedown = (e) => e.preventDefault()
    btn.onclick = () => {
      close()
      item.run()
    }
    menu.append(btn)
  }
  const r = anchor.getBoundingClientRect()
  menu.style.top = `${r.bottom + 4}px`
  document.body.append(menu)
  // stay inside the window (the help menu sits at the right edge)
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 4))}px`
  ;(menu.firstElementChild as HTMLElement)?.focus()

  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    const buttons = [...menu.querySelectorAll('button')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length].focus()
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length].focus()
    else return
    e.preventDefault()
  }
  function close() {
    openMenuState = null
    menu.remove()
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
  }
  openMenuState = { anchor, close }
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('keydown', onKey, true)
}

// ------------------------------------------------------------------ unsaved changes

export type SaveChoice = 'save' | 'discard' | 'cancel'

/** "Save changes?" with Speichern / Nicht speichern / Abbrechen. */
export async function askSaveChanges(name: string): Promise<SaveChoice> {
  const res = await openDialog({
    title: `Änderungen an „${name}“ speichern?`,
    fields: [],
    buttons: [
      { label: 'Nicht speichern', value: 'discard', danger: true },
      { label: 'Abbrechen', value: 'cancel' },
      { label: 'Speichern', value: 'save', primary: true },
    ],
  })
  return (res?.action as SaveChoice | undefined) ?? 'cancel'
}

/** A question with custom answers; resolves with the chosen value or 'cancel' (Esc). */
export async function askChoice(title: string, message: string, buttons: DialogButton[]): Promise<string> {
  const res = await openDialog({ title, message, fields: [], buttons })
  return res?.action ?? 'cancel'
}
