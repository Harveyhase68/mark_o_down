// Image picker: badges (shields.io, badgen.net, forthebadge.com), icons
// (Simple Icons), the user's own images next to the document, or any URL.
// This file is the frame (tabs, preview, footer); each tab lives in ./tabs/.

import { CONFIG_FILE, defaultConfig, loadConfig, readConfigText, type PickerConfig } from './config'
import { editConfig } from './configEditor'
import { renderBadgesTab } from './tabs/badges'
import { renderIconsTab } from './tabs/icons'
import { renderFilesTab } from './tabs/files'
import { renderUrlTab } from './tabs/url'
import { setTagAttr } from '../md/htmlTags'
import { el, field, textInput } from '../editor/dom'
import { openModal } from '../editor/modal'
import { t, type MessageKey } from '../i18n'

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

/** What a tab gets to work with. */
export interface TabContext {
  config: PickerConfig
  opts: PickerOptions
  /** The current selection (read-only; change it with `set`). */
  current: Readonly<PickedImage>
  set(p: Partial<PickedImage>): void
}

const TABS: [PickerTab, MessageKey, (pane: HTMLElement, ctx: TabContext) => void][] = [
  ['badges', 'picker.tabBadges', renderBadgesTab],
  ['icons', 'picker.tabIcons', renderIconsTab],
  ['files', 'picker.tabFiles', renderFilesTab],
  ['url', 'picker.tabUrl', renderUrlTab],
]

let lastTab: PickerTab = 'badges'

/** Markdown the selection will produce (shown in the footer). */
function previewMarkdown(p: PickedImage): string {
  const img = p.html ?? `![${p.alt.replace(/[[\]]/g, '\\$&')}](${/[\s()<>]/.test(p.src) ? `<${p.src}>` : p.src}${p.title ? ` "${p.title}"` : ''})`
  return p.link ? `[${img}](${p.link})` : img
}

/** Keep an `<img>` tag in sync with the chosen src/alt. */
const syncHtml = (tag: string, p: PickedImage) => setTagAttr(setTagAttr(tag, 'src', p.src), 'alt', p.alt)

export function openPicker(opts: PickerOptions): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const cur: PickedImage = { src: '', alt: '', title: null, link: null, html: null, ...opts.initial }

    // ---------------------------------------------------------------- frame
    const box = el('div', { class: 'picker' })
    const tabBar = el('nav', { class: 'pk-tabs', role: 'tablist' })
    const cfgBtn = el('button', { type: 'button', class: 'pk-link-btn', title: t('picker.configTip', { file: CONFIG_FILE }) }, t('picker.config'))
    const body = el('div', { class: 'pk-body' })
    const notice = el('div', { class: 'pk-notice', hidden: '' })

    const previewImg = el('img', { alt: '' })
    const previewBox = el('div', { class: 'pk-preview', 'data-missing': t('picker.previewMissing') }, previewImg)
    const altIn = textInput('', t('picker.altPlaceholder'))
    const linkIn = textInput('', t('picker.linkPlaceholder'))
    const code = el('code', { class: 'pk-code' })
    const cancel = el('button', { type: 'button' }, t('common.cancel'))
    const ok = el('button', { type: 'button', class: 'primary' }, t('common.insert'))
    box.append(
      el('header', {}, tabBar, cfgBtn),
      notice,
      body,
      el(
        'footer',
        {},
        previewBox,
        el('div', { class: 'pk-meta' }, field(t('picker.alt'), altIn), field(t('picker.link'), linkIn), code),
        el('div', { class: 'buttons' }, cancel, ok),
      ),
    )

    // ---------------------------------------------------------------- selection + preview
    let previewTimer = 0
    const ctx: TabContext = {
      config: defaultConfig(),
      opts,
      current: cur,
      set(p) {
        Object.assign(cur, p)
        if (p.alt !== undefined) altIn.value = p.alt
        if (p.link !== undefined) linkIn.value = p.link ?? ''
        refresh()
      },
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

    // ---------------------------------------------------------------- tabs
    const panes = new Map<PickerTab, HTMLElement>()
    const tabButtons = new Map<PickerTab, HTMLButtonElement>()
    for (const [id, label] of TABS) {
      const b = el('button', { type: 'button', role: 'tab' }, t(label))
      b.onclick = () => show(id)
      tabBar.append(b)
      tabButtons.set(id, b)
      const pane = el('section', { class: `pk-pane pk-${id}`, role: 'tabpanel' })
      panes.set(id, pane)
      body.append(pane)
    }

    function show(id: PickerTab) {
      lastTab = id
      for (const [k, b] of tabButtons) b.setAttribute('aria-selected', String(k === id))
      for (const [k, p] of panes) p.hidden = k !== id
      const pane = panes.get(id)!
      const hadFocus = pane.contains(document.activeElement)
      pane.replaceChildren()
      TABS.find(([tab]) => tab === id)![2](pane, ctx)
      // redrawing removed the focused field: don't leave the keyboard user nowhere
      if (hadFocus || !box.contains(document.activeElement)) {
        ;(pane.querySelector<HTMLElement>('input, select, button') ?? tabButtons.get(id))?.focus()
      }
    }

    function note(text: string | null) {
      notice.hidden = !text
      notice.textContent = text ?? ''
    }

    cfgBtn.onclick = async () => {
      const edited = await editConfig(await readConfigText())
      if (edited) {
        ctx.config = edited
        show(lastTab)
        note(null)
      }
    }

    // ---------------------------------------------------------------- close
    const close = (result: PickedImage | null) => {
      clearTimeout(previewTimer)
      modal.close()
      resolve(result)
    }
    const insert = () => cur.src && close({ ...cur })
    // Enter in a text field (or Ctrl+Enter anywhere) inserts; Esc/outside click: the modal frame
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !cur.src) return
      if (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault()
        insert()
      }
    })
    cancel.onclick = () => close(null)
    ok.onclick = insert
    const modal = openModal(box, { label: t('picker.label'), onCancel: () => close(null) })

    altIn.value = cur.alt
    linkIn.value = cur.link ?? ''
    refresh()
    show(opts.tab ?? (cur.src ? 'url' : lastTab))
    void loadConfig().then(({ config, error }) => {
      ctx.config = config
      if (error) note(error)
      show(lastTab)
    })
  })
}
