// Small DOM helpers shared by the dialogs.

/** `el('button', { type: 'button', class: 'x' }, 'Text', child)` */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.append(...children)
  return e
}

/** Label + control, stacked (used in dialog forms). */
export function field(label: string, input: HTMLElement, className = 'pk-field'): HTMLLabelElement {
  return el('label', { class: className }, el('span', {}, label), input)
}

export function textInput(value = '', placeholder = ''): HTMLInputElement {
  const i = el('input', { type: 'text', spellcheck: 'false' })
  i.value = value
  i.placeholder = placeholder
  return i
}

/** localStorage that never throws (private mode, quota, blocked storage). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* not persisted – fine */
    }
  },
}
