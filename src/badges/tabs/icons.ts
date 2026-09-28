// "Icons" tab: search an icon set (Simple Icons), insert as image or as badge.

import { fillTemplate, loadIcons, searchIcons, type IconEntry } from '../config'
import type { TabContext } from '../picker'
import * as host from '../../platform'
import { el, field, textInput } from '../../editor/dom'

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const MAX_HITS = 180
const STYLES = ['flat', 'flat-square', 'plastic', 'for-the-badge', 'social']

// remembered while the app runs
const state = {
  query: '',
  mode: 'icon' as 'icon' | 'badge',
  size: '32',
  style: 'flat',
  color: '',
  selected: null as IconEntry | null,
}

export function renderIconsTab(pane: HTMLElement, ctx: TabContext) {
  const set0 = ctx.config.iconSets[0]
  if (!set0) return void pane.append(el('p', { class: 'pk-empty' }, 'Kein Icon-Set konfiguriert.'))

  const search = textInput(state.query, `${set0.name} durchsuchen … (z. B. rust, github, docker)`)
  const status = el('span', { class: 'pk-status' }, 'Lade Icon-Liste …')
  const reload = el('button', { type: 'button', class: 'pk-link-btn', title: 'Icon-Liste neu herunterladen' }, '↻ aktualisieren')
  const grid = el('div', { class: 'pk-grid' })

  const mode = el('select')
  mode.append(el('option', { value: 'icon' }, 'Icon (Bild)'), el('option', { value: 'badge' }, 'Badge mit Logo (shields.io)'))
  mode.value = state.mode
  const size = textInput(state.size, 'leer = Originalgröße')
  const color = textInput(state.color, 'Markenfarbe')
  const style = el('select')
  for (const s of STYLES) style.append(el('option', { value: s }, s))
  style.value = state.style
  const options = el('div', { class: 'pk-form pk-inline' }, field('Einfügen als', mode), field('Größe (px)', size), field('Farbe', color), field('Badge-Stil', style))

  const syncDisabled = () => {
    size.disabled = state.mode === 'badge'
    style.disabled = state.mode === 'icon'
  }
  const apply = () => {
    const icon = state.selected
    if (!icon) return
    const values = { slug: icon.slug, title: icon.title, hex: icon.hex, color: state.color || icon.hex, style: state.style }
    const src = fillTemplate(state.mode === 'badge' ? set0.badge : set0.icon, values)
    const px = state.mode === 'icon' ? state.size.trim() : ''
    // a sized icon needs an <img> tag (Markdown images have no size)
    const html = /^\d+$/.test(px) ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(icon.title)}" width="${px}" height="${px}">` : null
    ctx.set({ src, alt: icon.title, html, title: null })
  }
  mode.onchange = () => {
    state.mode = mode.value as 'icon' | 'badge'
    syncDisabled()
    apply()
  }
  size.oninput = () => ((state.size = size.value), apply())
  color.oninput = () => ((state.color = color.value.trim()), apply())
  style.onchange = () => ((state.style = style.value), apply())
  syncDisabled()

  let all: IconEntry[] = []
  const draw = () => {
    grid.replaceChildren()
    const hits = searchIcons(all, state.query, MAX_HITS)
    status.textContent = `${all.length} Icons · ${state.query ? `${hits.length}${hits.length === MAX_HITS ? '+' : ''} Treffer` : 'Suchbegriff eingeben'}`
    for (const icon of hits) {
      const b = el(
        'button',
        { type: 'button', class: 'pk-tile', title: `${icon.title} (${icon.slug})`, 'aria-pressed': String(state.selected?.slug === icon.slug) },
        el('img', { src: fillTemplate(set0.icon, { slug: icon.slug, color: icon.hex }), alt: '', loading: 'lazy', width: '28', height: '28' }),
        el('span', {}, icon.title),
      )
      b.onclick = () => {
        state.selected = icon
        for (const t of grid.children) t.setAttribute('aria-pressed', String(t === b))
        apply()
      }
      grid.append(b)
    }
  }
  search.oninput = () => {
    state.query = search.value
    draw()
  }
  const load = (force: boolean) =>
    loadIcons(set0, ctx.config.cacheHours, force)
      .then((list) => {
        all = list
        draw()
      })
      .catch((e) => (status.textContent = `Icon-Liste nicht verfügbar: ${e}`))
  reload.onclick = () => {
    status.textContent = 'Lade Icon-Liste …'
    void load(true)
  }
  const home = el('a', { href: set0.home, class: 'pk-home' }, set0.home.replace(/^https?:\/\//, ''))
  home.onclick = (e) => {
    e.preventDefault()
    void host.openExternal(set0.home)
  }

  pane.append(el('div', { class: 'pk-row' }, search, home), options, el('div', { class: 'pk-row' }, status, reload), grid)
  void load(false)
  search.focus()
}
