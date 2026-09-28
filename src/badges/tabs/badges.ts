// "Badges" tab: providers (shields.io, badgen.net …) and their templates.

import { defaultValues, fillTemplate, type BadgeTemplate } from '../config'
import type { TabContext } from '../picker'
import * as host from '../../platform'
import { el, field, textInput } from '../../editor/dom'

// remembered while the app runs
let lastProvider = 0
let lastTemplate = 0

export function renderBadgesTab(pane: HTMLElement, ctx: TabContext) {
  const providers = ctx.config.providers
  if (!providers.length) return void pane.append(el('p', { class: 'pk-empty' }, 'Keine Anbieter konfiguriert.'))
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
  const home = el('a', { href: provider.home, class: 'pk-home', title: 'Webseite des Anbieters' }, provider.home.replace(/^https?:\/\//, ''))
  home.onclick = (e) => {
    e.preventDefault()
    void host.openExternal(provider.home)
  }

  const list = el('div', { class: 'pk-list', role: 'listbox' })
  const form = el('div', { class: 'pk-form' })
  provider.templates.forEach((t, i) => {
    const item = el('button', { type: 'button', role: 'option', 'aria-selected': String(i === lastTemplate) }, t.name)
    item.onclick = () => {
      lastTemplate = i
      for (const b of list.children) b.setAttribute('aria-selected', String(b === item))
      renderForm(form, t, ctx)
    }
    list.append(item)
  })

  pane.append(el('div', { class: 'pk-row' }, chips, home), el('div', { class: 'pk-split' }, list, form))
  if (provider.templates[lastTemplate]) renderForm(form, provider.templates[lastTemplate], ctx)
}

/** Fields of one template; every change updates the selection (live preview). */
function renderForm(form: HTMLElement, t: BadgeTemplate, ctx: TabContext) {
  form.replaceChildren()
  const values = defaultValues(t)
  const update = () =>
    ctx.set({
      src: fillTemplate(t.url, values),
      alt: t.alt ? fillTemplate(t.alt, values, false) : t.name,
      link: t.link ? fillTemplate(t.link, values) || null : null,
      html: null,
      title: null,
    })
  for (const f of t.fields) {
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
  if (!t.fields.length) form.append(el('p', { class: 'pk-empty' }, 'Fertiges Badge – keine Einstellungen nötig.'))
  update()
}
