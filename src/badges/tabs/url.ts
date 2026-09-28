// "URL" tab: any address or path (also used when editing an existing image).

import type { TabContext } from '../picker'
import { el, field, textInput } from '../../editor/dom'

export function renderUrlTab(pane: HTMLElement, ctx: TabContext) {
  const src = textInput(ctx.current.src, 'https://… oder bilder/logo.png')
  const title = textInput(ctx.current.title ?? '', 'Tooltip (optional)')
  src.oninput = () => ctx.set({ src: src.value.trim() })
  title.oninput = () => ctx.set({ title: title.value || null })
  pane.append(el('div', { class: 'pk-form' }, field('Adresse oder Pfad', src), field('Titel', title)))
  if (ctx.current.html) pane.append(el('p', { class: 'pk-empty' }, 'HTML-Bild: Größe und weitere Attribute des <img>-Tags bleiben erhalten.'))
  src.focus()
}
