// [[toc]] in the editor: a block that shows the generated table of contents (md/toc.ts).
// A click on an entry goes there, double-click changes the depth; typing `[[toc]]` on an
// empty line makes one. What it lists comes from main.ts (the workspace or the document).

import { InputRule } from 'prosemirror-inputrules'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeViewConstructor } from 'prosemirror-view'
import { schema } from '../md/schema'
import { DEFAULT_TOC_DEPTH, parseTocMarker, tocOn, type TocItem } from '../md/toc'
import { openDialog } from './dialog'
import { t } from '../i18n'

const S = schema.nodes

export interface TocSource {
  /** the entries for `depth` */
  items: (depth: number) => Promise<TocItem[]>
  /** an entry was clicked */
  follow: (href: string) => void
  /** in a workspace (the empty text differs) */
  workspace: () => boolean
}

let source: TocSource | null = null
const shown = new Set<() => void>()
let timer = 0

export function configureToc(s: TocSource) {
  source = s
}

/** Draw all tables of contents again (soon – several calls in a row draw once). */
export function refreshTocs(delay = 300) {
  if (!shown.size) return
  clearTimeout(timer)
  timer = window.setTimeout(() => shown.forEach((draw) => draw()), delay)
}

/** `[[toc]]` typed on an empty line: the line becomes the table of contents. */
export function tocInputRule(): InputRule {
  return new InputRule(/^\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if (!tocOn() || !parseTocMarker(match[0]) || $start.parent.type !== S.paragraph || end !== $start.end()) return null
    const from = $start.before()
    const tr = state.tr.replaceWith(from, $start.after(), [S.toc.create({ raw: match[0] }), S.paragraph.create()])
    return tr.setSelection(TextSelection.create(tr.doc, from + 2)).scrollIntoView()
  })
}

function list(items: TocItem[]): HTMLUListElement {
  const ul = document.createElement('ul')
  for (const item of items) {
    const li = document.createElement('li')
    const label = document.createElement(item.href ? 'a' : 'span')
    label.textContent = item.text
    if (item.href) {
      label.setAttribute('href', item.href)
      label.title = item.href
    }
    if (item.folder) li.className = 'toc-folder'
    li.append(label)
    if (item.children.length) li.append(list(item.children))
    ul.append(li)
  }
  return ul
}

export const tocView: NodeViewConstructor = (node, view, getPos) => {
  let raw: string = node.attrs.raw
  const dom = document.createElement('nav')
  dom.className = 'toc-block'
  dom.contentEditable = 'false'
  const head = document.createElement('div')
  head.className = 'toc-head'
  const body = document.createElement('div')
  body.className = 'toc-body'
  dom.append(head, body)

  let drawing = 0
  const draw = async () => {
    const depth = parseTocMarker(raw)?.depth ?? DEFAULT_TOC_DEPTH
    head.textContent = t('toc.title')
    dom.title = `${raw} – ${t('toc.hint')}`
    if (!source) return
    const mine = ++drawing
    const items = await source.items(depth).catch(() => [] as TocItem[])
    if (mine !== drawing) return // a newer drawing is under way
    body.replaceChildren(items.length ? list(items) : Object.assign(document.createElement('div'), { className: 'toc-empty', textContent: t(source.workspace() ? 'toc.emptyWorkspace' : 'toc.empty') }))
  }
  shown.add(draw)
  void draw()

  // an entry: go there (a plain click – the entries can't be edited anyway)
  dom.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('a')) e.preventDefault()
  })
  dom.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    source?.follow(a.getAttribute('href')!)
  })
  dom.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('a')) return
    e.preventDefault()
    void editDepth(view, getPos()!)
  })

  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      if (next.attrs.raw !== raw) {
        raw = next.attrs.raw
        void draw()
      }
      return true
    },
    stopEvent: (e) => e.type === 'click' || e.type === 'dblclick' || (e.type === 'mousedown' && !!(e.target as HTMLElement).closest('a')),
    ignoreMutation: () => true,
    destroy: () => void shown.delete(draw),
  }
}

async function editDepth(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== S.toc) return
  const depth = parseTocMarker(node.attrs.raw)?.depth ?? DEFAULT_TOC_DEPTH
  const res = await openDialog({ title: t('toc.title'), message: t('toc.depthHelp'), fields: [{ name: 'depth', label: t('toc.depth'), value: String(depth) }] })
  view.focus()
  const d = Math.round(Number(res?.values.depth))
  if (!res || !(d >= 1 && d <= 6) || d === depth) return
  view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, raw: d === DEFAULT_TOC_DEPTH ? '[[toc]]' : `[[toc depth=${d}]]` }))
}
