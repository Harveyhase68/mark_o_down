// "URL" tab: any address or path (also used when editing an existing image).

import type { TabContext } from '../picker'
import { el, field, textInput } from '../../editor/dom'
import { t } from '../../i18n'

export function renderUrlTab(pane: HTMLElement, ctx: TabContext) {
  const src = textInput(ctx.current.src, t('picker.urlSrcPlaceholder'))
  const title = textInput(ctx.current.title ?? '', t('picker.urlTitlePlaceholder'))
  src.oninput = () => ctx.set({ src: src.value.trim() })
  title.oninput = () => ctx.set({ title: title.value || null })
  pane.append(el('div', { class: 'pk-form' }, field(t('picker.urlSrc'), src), field(t('picker.urlTitle'), title)))
  if (ctx.current.html) pane.append(el('p', { class: 'pk-empty' }, t('picker.urlHtml')))
  src.focus()
}
