// "Eigene Bilder" tab: images in the document's folder (and below), or any file.

import type { TabContext } from '../picker'
import * as host from '../../platform'
import { el, textInput } from '../../editor/dom'

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
  const filter = textInput(filterText, 'Dateiname filtern …')
  const choose = el('button', { type: 'button' }, 'Datei wählen …')
  const grid = el('div', { class: 'pk-grid pk-files' })
  const status = el('span', { class: 'pk-status' })
  choose.hidden = !opts.pickFile
  choose.onclick = async () => {
    const p = await opts.pickFile?.()
    if (p) ctx.set({ src: p, alt: altFromPath(p), html: null, title: null })
  }
  pane.append(el('div', { class: 'pk-row' }, filter, choose), status, grid)

  if (!opts.docPath) {
    status.textContent = 'Das Dokument ist noch nicht gespeichert – Bilder werden relativ zum Speicherort des .md gesucht.'
    return
  }
  const dir = host.dirname(opts.docPath)
  status.textContent = 'Suche Bilder …'
  let all: string[] = []
  const draw = () => {
    grid.replaceChildren()
    const q = filterText.toLowerCase()
    const hits = all.filter((f) => f.toLowerCase().includes(q))
    status.textContent = `${hits.length} Bild(er) in ${dir}`
    for (const f of hits.slice(0, MAX_TILES)) {
      const rel = host.encodePath(f)
      const b = el(
        'button',
        { type: 'button', class: 'pk-tile', title: f, 'aria-pressed': String(ctx.current.src === rel) },
        el('img', { src: opts.resolveImage(rel), alt: '', loading: 'lazy' }),
        el('span', {}, f),
      )
      b.onclick = () => {
        for (const t of grid.children) t.setAttribute('aria-pressed', String(t === b))
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
