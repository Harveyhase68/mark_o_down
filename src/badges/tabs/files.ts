// "Own images" tab: images in the document's folder (and below), or any file.

import type { TabContext } from '../picker'
import * as host from '../../platform'
import { el, textInput } from '../../editor/dom'
import { t } from '../../i18n'

const MAX_TILES = 300

let filterText = ''

/** "bilder/mein-logo_2.png" → "mein logo 2" */
export function altFromPath(p: string): string {
  return decodeURIComponent(p.split('/').pop() ?? p)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
}

export function renderFilesTab(pane: HTMLElement, ctx: TabContext) {
  const { opts } = ctx
  const filter = textInput(filterText, t('picker.filesFilter'))
  const choose = el('button', { type: 'button' }, t('picker.filesChoose'))
  const grid = el('div', { class: 'pk-grid pk-files' })
  const status = el('span', { class: 'pk-status' })
  choose.hidden = !opts.pickFile
  choose.onclick = async () => {
    const p = await opts.pickFile?.()
    if (p) ctx.set({ src: p, alt: altFromPath(p), html: null, title: null })
  }
  pane.append(el('div', { class: 'pk-row' }, filter, choose), status, grid)

  if (!opts.docPath) {
    status.textContent = t('picker.filesUnsaved')
    return
  }
  const dir = host.dirname(opts.docPath)
  status.textContent = t('picker.filesSearching')
  let all: string[] = []
  const draw = () => {
    grid.replaceChildren()
    const q = filterText.toLowerCase()
    const hits = all.filter((f) => f.toLowerCase().includes(q))
    status.textContent = t('picker.filesCount', { n: hits.length, dir })
    for (const f of hits.slice(0, MAX_TILES)) {
      const rel = host.encodePath(f)
      const b = el(
        'button',
        { type: 'button', class: 'pk-tile', title: f, 'aria-pressed': String(ctx.current.src === rel) },
        el('img', { src: opts.resolveImage(rel), alt: '', loading: 'lazy' }),
        el('span', {}, f),
      )
      b.onclick = () => {
        for (const tile of grid.children) tile.setAttribute('aria-pressed', String(tile === b))
        ctx.set({ src: rel, alt: altFromPath(f), html: null, title: null })
      }
      grid.append(b)
    }
  }
  filter.oninput = () => {
    filterText = filter.value
    draw()
  }
  void host.listImages(dir).then((list) => {
    all = list
    draw()
  })
}
