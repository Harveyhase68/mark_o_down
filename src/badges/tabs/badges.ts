// "Badges" tab: providers (shields.io, badgen.net …) and their templates.

import { defaultValues, fillTemplate, type BadgeTemplate } from '../config'
import type { TabContext } from '../picker'
import * as host from '../../platform'
import { el, field, textInput } from '../../editor/dom'
import { t } from '../../i18n'

// remembered while the app runs
let lastProvider = 0
let lastTemplate = 0

export function renderBadgesTab(pane: HTMLElement, ctx: TabContext) {
  const providers = ctx.config.providers
  if (!providers.length) return void pane.append(el('p', { class: 'pk-empty' }, t('picker.noProviders')))
  lastProvider = Math.min(lastProvider, providers.length - 1)
  const provider = providers[lastProvider]
  lastTemplate = Math.min(lastTemplate, Math.max(0, provider.templates.length - 1))

  const chips = el('div', { class: 'pk-chips' })
  providers.forEach((p, i) => {
    const c = el('button', { type: 'button', class: 'pk-chip', 'aria-pressed': String(i === lastProvider) }, p.name)
    c.onclick = () => {
      lastProvider = i
      lastTemplate = 0
      pane.replaceChildren()
      renderBadgesTab(pane, ctx)
    }
    chips.append(c)
  })
  const home = el('a', { href: provider.home, class: 'pk-home', title: t('picker.providerSite') }, provider.home.replace(/^https?:\/\//, ''))
  home.onclick = (e) => {
    e.preventDefault()
    void host.openExternal(provider.home)
  }

  const list = el('div', { class: 'pk-list', role: 'listbox' })
  const form = el('div', { class: 'pk-form' })
  provider.templates.forEach((tpl, i) => {
    const item = el('button', { type: 'button', role: 'option', 'aria-selected': String(i === lastTemplate) }, tpl.name)
    item.onclick = () => {
      lastTemplate = i
      for (const b of list.children) b.setAttribute('aria-selected', String(b === item))
      renderForm(form, tpl, ctx)
    }
    list.append(item)
  })

  pane.append(el('div', { class: 'pk-row' }, chips, home), el('div', { class: 'pk-split' }, list, form))
  if (provider.templates[lastTemplate]) renderForm(form, provider.templates[lastTemplate], ctx)
}

/** Fields of one template; every change updates the selection (live preview). */
function renderForm(form: HTMLElement, tpl: BadgeTemplate, ctx: TabContext) {
  form.replaceChildren()
  const values = defaultValues(tpl)
  const update = () =>
    ctx.set({
      src: fillTemplate(tpl.url, values),
      alt: tpl.alt ? fillTemplate(tpl.alt, values, false) : tpl.name,
      link: tpl.link ? fillTemplate(tpl.link, values) || null : null,
      html: null,
      title: null,
    })
  for (const f of tpl.fields) {
    let input: HTMLInputElement | HTMLSelectElement
    if (f.options) {
      input = el('select')
      for (const o of f.options) input.append(el('option', { value: o }, o))
    } else input = textInput('', f.placeholder)
    input.value = values[f.key] ?? ''
    input.oninput = () => {
      values[f.key] = input.value
      update()
    }
    form.append(field(f.label, input))
  }
  if (!tpl.fields.length) form.append(el('p', { class: 'pk-empty' }, t('picker.readyBadge')))
  update()
}
