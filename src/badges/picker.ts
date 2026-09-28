// Image picker: badges (shields.io, badgen.net, forthebadge.com), icons
// (Simple Icons), the user's own images next to the document, or any URL.

import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  configText,
  defaultValues,
  fillTemplate,
  loadConfig,
  loadIcons,
  saveConfig,
  searchIcons,
  type BadgeProvider,
  type BadgeTemplate,
  type IconEntry,
  type PickerConfig,
} from './config'
import * as host from '../platform'

export interface PickedImage {
  src: string
  alt: string
  title: string | null
  /** Makes the image clickable. */
  link: string | null
  /** An `<img>` tag (used when a size is set). */
  html: string | null
}

export type PickerTab = 'badges' | 'icons' | 'files' | 'url'

export interface PickerOptions {
  tab?: PickerTab
  initial?: Partial<PickedImage>
  docPath: string | null
  resolveImage: (src: string) => string
  /** Native file dialog; returns a path relative to the document. */
  pickFile?: () => Promise<string | null>
}

const TABS: [PickerTab, string][] = [
  ['badges', 'Badges'],
  ['icons', 'Icons'],
  ['files', 'Eigene Bilder'],
  ['url', 'URL'],
]

let lastTab: PickerTab = 'badges'
let lastProvider = 0
let lastTemplate = 0

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.append(...children)
  return e
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  return el('label', { class: 'pk-field' }, el('span', {}, label), input)
}

function textInput(value = '', placeholder = ''): HTMLInputElement {
  const i = el('input', { type: 'text', spellcheck: 'false' })
  i.value = value
  i.placeholder = placeholder
  return i
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Markdown the selection will produce (shown in the footer). */
function previewMarkdown(p: PickedImage): string {
  const img = p.html ?? `![${p.alt.replace(/[[\]]/g, '\\$&')}](${/[\s()<>]/.test(p.src) ? `<${p.src}>` : p.src}${p.title ? ` "${p.title}"` : ''})`
  return p.link ? `[${img}](${p.link})` : img
}

export function openPicker(opts: PickerOptions): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    let config: PickerConfig = DEFAULT_CONFIG
    const cur: PickedImage = { src: '', alt: '', title: null, link: null, html: null, ...opts.initial }

    // ---------------------------------------------------------------- shell
    const backdrop = el('div', { class: 'dialog-backdrop' })
    const box = el('div', { class: 'picker', role: 'dialog', 'aria-label': 'Bild, Badge oder Icon einfügen' })
    const tabBar = el('nav', { class: 'pk-tabs', role: 'tablist' })
    const cfgBtn = el('button', { type: 'button', class: 'pk-link-btn', title: `${CONFIG_FILE} bearbeiten` }, '⚙ Konfiguration…')
    const header = el('header', {}, tabBar, cfgBtn)
    const body = el('div', { class: 'pk-body' })
    const notice = el('div', { class: 'pk-notice', hidden: '' })

    const previewImg = el('img', { alt: '' })
    const previewBox = el('div', { class: 'pk-preview' }, previewImg)
    const altIn = textInput('', 'Beschreibung des Bildes')
    const linkIn = textInput('', 'https://… (optional)')
    const code = el('code', { class: 'pk-code' })
    const cancel = el('button', { type: 'button' }, 'Abbrechen')
    const ok = el('button', { type: 'button', class: 'primary' }, 'Einfügen')
    const footer = el(
      'footer',
      {},
      previewBox,
      el('div', { class: 'pk-meta' }, field('Alternativtext', altIn), field('Link (klickbar)', linkIn), code),
      el('div', { class: 'buttons' }, cancel, ok),
    )
    box.append(header, notice, body, footer)
    backdrop.append(box)
    document.body.append(backdrop)

    const panes = new Map<PickerTab, HTMLElement>()
    const tabBtns = new Map<PickerTab, HTMLButtonElement>()
    for (const [id, label] of TABS) {
      const b = el('button', { type: 'button', role: 'tab' }, label)
      b.onclick = () => show(id)
      tabBar.append(b)
      tabBtns.set(id, b)
      const pane = el('section', { class: `pk-pane pk-${id}`, role: 'tabpanel' })
      panes.set(id, pane)
      body.append(pane)
    }

    function show(id: PickerTab) {
      lastTab = id
      for (const [k, b] of tabBtns) b.setAttribute('aria-selected', String(k === id))
      for (const [k, p] of panes) p.hidden = k !== id
      renderers[id]()
    }

    function note(text: string | null) {
      notice.hidden = !text
      notice.textContent = text ?? ''
    }

    // ---------------------------------------------------------------- selection
    let previewTimer = 0
    function set(p: Partial<PickedImage>) {
      Object.assign(cur, p)
      if (p.alt !== undefined) altIn.value = p.alt
      if (p.link !== undefined) linkIn.value = p.link ?? ''
      refresh()
    }
    function refresh() {
      if (cur.html) cur.html = syncHtml(cur.html, cur)
      code.textContent = cur.src ? previewMarkdown(cur) : ''
      ok.disabled = !cur.src
      clearTimeout(previewTimer)
      previewTimer = window.setTimeout(() => {
        previewBox.classList.remove('broken')
        previewImg.src = cur.src ? opts.resolveImage(cur.src) : ''
        previewImg.hidden = !cur.src
      }, 300)
    }
    previewImg.onerror = () => previewBox.classList.add('broken')
    altIn.oninput = () => {
      cur.alt = altIn.value
      refresh()
    }
    linkIn.oninput = () => {
      cur.link = linkIn.value.trim() || null
      refresh()
    }

    // ---------------------------------------------------------------- badges
    const badges = panes.get('badges')!
    function renderBadges() {
      badges.replaceChildren()
      const providers = config.providers
      if (!providers.length) return void badges.append(el('p', { class: 'pk-empty' }, 'Keine Anbieter konfiguriert.'))
      lastProvider = Math.min(lastProvider, providers.length - 1)
      const provider: BadgeProvider = providers[lastProvider]
      lastTemplate = Math.min(lastTemplate, Math.max(0, provider.templates.length - 1))

      const chips = el('div', { class: 'pk-chips' })
      providers.forEach((p, i) => {
        const c = el('button', { type: 'button', class: 'pk-chip', 'aria-pressed': String(i === lastProvider) }, p.name)
        c.onclick = () => {
          lastProvider = i
          lastTemplate = 0
          renderBadges()
        }
        chips.append(c)
      })
      const home = el('a', { href: provider.home, class: 'pk-home', title: 'Webseite des Anbieters (Strg+Klick)' }, provider.home.replace(/^https?:\/\//, ''))
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
          renderForm(t)
        }
        list.append(item)
      })

      function renderForm(t: BadgeTemplate) {
        form.replaceChildren()
        const values = defaultValues(t)
        const update = () => {
          set({
            src: fillTemplate(t.url, values),
            alt: t.alt ? fillTemplate(t.alt, values, false) : t.name,
            link: t.link ? fillTemplate(t.link, values).replace(/^$/, '') || null : null,
            html: null,
            title: null,
          })
        }
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

      badges.append(el('div', { class: 'pk-row' }, chips, home), el('div', { class: 'pk-split' }, list, form))
      if (provider.templates[lastTemplate]) renderForm(provider.templates[lastTemplate])
    }

    // ---------------------------------------------------------------- icons
    const icons = panes.get('icons')!
    let iconQuery = ''
    let iconMode: 'icon' | 'badge' = 'icon'
    let iconSize = '32'
    let iconStyle = 'flat'
    let iconColor = ''
    let selected: IconEntry | null = null
    function renderIcons() {
      icons.replaceChildren()
      const set0 = config.iconSets[0]
      if (!set0) return void icons.append(el('p', { class: 'pk-empty' }, 'Kein Icon-Set konfiguriert.'))
      const search = textInput(iconQuery, `${set0.name} durchsuchen … (z. B. rust, github, docker)`)
      const status = el('span', { class: 'pk-status' }, 'Lade Icon-Liste …')
      const reload = el('button', { type: 'button', class: 'pk-link-btn', title: 'Icon-Liste neu herunterladen' }, '↻ aktualisieren')
      const grid = el('div', { class: 'pk-grid' })

      const mode = el('select')
      mode.append(el('option', { value: 'icon' }, 'Icon (Bild)'), el('option', { value: 'badge' }, 'Badge mit Logo (shields.io)'))
      mode.value = iconMode
      const size = textInput(iconSize, 'leer = Originalgröße')
      const color = textInput(iconColor, 'Markenfarbe')
      const style = el('select')
      for (const s of ['flat', 'flat-square', 'plastic', 'for-the-badge', 'social']) style.append(el('option', { value: s }, s))
      style.value = iconStyle
      const opts1 = el('div', { class: 'pk-form pk-inline' }, field('Einfügen als', mode), field('Größe (px)', size), field('Farbe', color), field('Badge-Stil', style))

      const apply = () => {
        if (!selected) return
        const values = { slug: selected.slug, title: selected.title, hex: selected.hex, color: iconColor || selected.hex, style: iconStyle }
        const src = fillTemplate(iconMode === 'badge' ? set0.badge : set0.icon, values)
        const px = iconMode === 'icon' ? iconSize.trim() : ''
        const html = /^\d+$/.test(px) ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(selected.title)}" width="${px}" height="${px}">` : null
        set({ src, alt: selected.title, html, title: null })
      }
      mode.onchange = () => {
        iconMode = mode.value as 'icon' | 'badge'
        size.disabled = iconMode === 'badge'
        style.disabled = iconMode === 'icon'
        apply()
      }
      size.oninput = () => ((iconSize = size.value), apply())
      color.oninput = () => ((iconColor = color.value.trim()), apply())
      style.onchange = () => ((iconStyle = style.value), apply())
      size.disabled = iconMode === 'badge'
      style.disabled = iconMode === 'icon'

      let all: IconEntry[] = []
      const draw = () => {
        grid.replaceChildren()
        const hits = searchIcons(all, iconQuery, 180)
        status.textContent = `${all.length} Icons · ${iconQuery ? `${hits.length}${hits.length === 180 ? '+' : ''} Treffer` : 'Suchbegriff eingeben'}`
        for (const i of hits) {
          const b = el(
            'button',
            { type: 'button', class: 'pk-tile', title: `${i.title} (${i.slug})`, 'aria-pressed': String(selected?.slug === i.slug) },
            el('img', { src: fillTemplate(set0.icon, { slug: i.slug, color: i.hex }), alt: '', loading: 'lazy', width: '28', height: '28' }),
            el('span', {}, i.title),
          )
          b.onclick = () => {
            selected = i
            for (const t of grid.children) t.setAttribute('aria-pressed', String(t === b))
            apply()
          }
          grid.append(b)
        }
      }
      search.oninput = () => {
        iconQuery = search.value
        draw()
      }
      const load = (force: boolean) =>
        loadIcons(set0, config.cacheHours, force)
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
      icons.append(el('div', { class: 'pk-row' }, search, home), opts1, el('div', { class: 'pk-row' }, status, reload), grid)
      void load(false)
      search.focus()
    }

    // ---------------------------------------------------------------- own files
    const files = panes.get('files')!
    let fileFilter = ''
    function renderFiles() {
      files.replaceChildren()
      const filter = textInput(fileFilter, 'Dateiname filtern …')
      const choose = el('button', { type: 'button' }, 'Datei wählen …')
      const grid = el('div', { class: 'pk-grid pk-files' })
      const status = el('span', { class: 'pk-status' })
      choose.hidden = !opts.pickFile
      choose.onclick = async () => {
        const p = await opts.pickFile?.()
        if (p) set({ src: p, alt: altFromPath(p), html: null, title: null })
      }
      files.append(el('div', { class: 'pk-row' }, filter, choose), status, grid)
      if (!opts.docPath) {
        status.textContent = 'Das Dokument ist noch nicht gespeichert – Bilder werden relativ zum Speicherort des .md gesucht.'
        return
      }
      status.textContent = 'Suche Bilder …'
      let all: string[] = []
      const draw = () => {
        grid.replaceChildren()
        const q = fileFilter.toLowerCase()
        const hits = all.filter((f) => f.toLowerCase().includes(q))
        status.textContent = `${hits.length} Bild(er) in ${host.dirname(opts.docPath!)}`
        for (const f of hits.slice(0, 300)) {
          const rel = f.replace(/ /g, '%20')
          const b = el('button', { type: 'button', class: 'pk-tile', title: f, 'aria-pressed': String(cur.src === rel) }, el('img', { src: opts.resolveImage(rel), alt: '', loading: 'lazy' }), el('span', {}, f))
          b.onclick = () => {
            for (const t of grid.children) t.setAttribute('aria-pressed', String(t === b))
            set({ src: rel, alt: altFromPath(f), html: null, title: null })
          }
          grid.append(b)
        }
      }
      filter.oninput = () => {
        fileFilter = filter.value
        draw()
      }
      void host.listImages(host.dirname(opts.docPath)).then((list) => {
        all = list
        draw()
      })
    }

    // ---------------------------------------------------------------- url
    const url = panes.get('url')!
    function renderUrl() {
      url.replaceChildren()
      const src = textInput(cur.src, 'https://… oder bilder/logo.png')
      const title = textInput(cur.title ?? '', 'Tooltip (optional)')
      src.oninput = () => set({ src: src.value.trim() })
      title.oninput = () => set({ title: title.value || null })
      url.append(el('div', { class: 'pk-form' }, field('Adresse oder Pfad', src), field('Titel', title)))
      if (cur.html) url.append(el('p', { class: 'pk-empty' }, 'HTML-Bild: Größe und weitere Attribute des <img>-Tags bleiben erhalten.'))
      src.focus()
    }

    const renderers: Record<PickerTab, () => void> = { badges: renderBadges, icons: renderIcons, files: renderFiles, url: renderUrl }

    // ---------------------------------------------------------------- config editor
    cfgBtn.onclick = async () => {
      const current = (await host.configRead(CONFIG_FILE).catch(() => null)) ?? configText(config)
      const edited = await editConfig(current)
      if (edited) {
        config = edited
        show(lastTab)
        note(null)
      }
    }

    // ---------------------------------------------------------------- close
    const close = (result: PickedImage | null) => {
      clearTimeout(previewTimer)
      backdrop.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.cfg-editor')) return // nested dialog handles its keys
      if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      } else if (e.key === 'Enter' && (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') && cur.src) {
        e.preventDefault()
        close({ ...cur })
      }
    }
    document.addEventListener('keydown', onKey, true)
    cancel.onclick = () => close(null)
    ok.onclick = () => cur.src && close({ ...cur })
    backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close(null))

    altIn.value = cur.alt
    linkIn.value = cur.link ?? ''
    refresh()
    show(opts.tab ?? (cur.src ? 'url' : lastTab))
    void loadConfig().then(({ config: c, error }) => {
      config = c
      if (error) note(error)
      renderers[lastTab]()
    })
  })
}

function altFromPath(p: string): string {
  return decodeURIComponent(p.split('/').pop() ?? p).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
}

/** Keep an `<img>` tag in sync with the chosen src/alt. */
function syncHtml(tag: string, p: PickedImage): string {
  return tag.replace(/\ssrc="[^"]*"/, ` src="${escapeAttr(p.src)}"`).replace(/\salt="[^"]*"/, ` alt="${escapeAttr(p.alt)}"`)
}

// ------------------------------------------------------------------ config editor

function editConfig(text: string): Promise<PickerConfig | null> {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'dialog-backdrop' })
    const area = el('textarea', { spellcheck: 'false' })
    area.value = text
    const error = el('p', { class: 'pk-error', hidden: '' })
    const save = el('button', { type: 'button', class: 'primary' }, 'Speichern')
    const cancel = el('button', { type: 'button' }, 'Abbrechen')
    const reset = el('button', { type: 'button' }, 'Standard wiederherstellen')
    const folder = el('button', { type: 'button' }, 'Im Explorer zeigen')
    folder.hidden = !host.isTauri
    const box = el(
      'div',
      { class: 'dialog cfg-editor', role: 'dialog' },
      el('h2', {}, `Badge- & Icon-Quellen (${CONFIG_FILE})`),
      el(
        'p',
        { class: 'pk-empty' },
        'Anbieter, Vorlagen und Icon-Sets als JSON. Platzhalter: {feld}, {feld|raw}, {feld|shields}, {feld|hex}. Leere Query-Parameter werden entfernt. "cacheHours" = wie lange Icon-Listen zwischengespeichert werden.',
      ),
      area,
      error,
      el('div', { class: 'buttons' }, folder, reset, cancel, save),
    )
    backdrop.append(box)
    document.body.append(backdrop)
    area.focus()

    const close = (c: PickerConfig | null) => {
      backdrop.remove()
      resolve(c)
    }
    cancel.onclick = () => close(null)
    reset.onclick = () => {
      area.value = configText(DEFAULT_CONFIG)
      error.hidden = true
    }
    folder.onclick = () => void host.revealConfigFile(CONFIG_FILE)
    save.onclick = async () => {
      try {
        close(await saveConfig(area.value))
      } catch (e) {
        error.hidden = false
        error.textContent = `Nicht gespeichert: ${(e as Error).message}`
      }
    }
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(null)
      }
      if (e.key === 's' && e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        save.click()
      }
      // Tab inserts spaces in the JSON editor
      if (e.key === 'Tab' && e.target === area) {
        e.preventDefault()
        area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end')
      }
    })
  })
}
