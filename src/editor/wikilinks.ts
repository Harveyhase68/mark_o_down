// Wiki links in the editor: typing `[[Link]]` makes one, double-click edits target and
// text, a target that does not exist is underlined (dashed red, like Obsidian).
// Following one (Ctrl+click) goes through main.ts followLink, like any link.

import { InputRule } from 'prosemirror-inputrules'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeViewConstructor } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../md/schema'
import { wikiLinksOn } from '../md/markdown'
import { parseWiki, wikiDisplay, wikiFile, wikiHref, wikiRaw } from '../md/wikilink'
import { findAnchor } from '../md/anchors'
import * as host from '../platform'
import { openDialog } from './dialog'
import { t } from '../i18n'

const S = schema.nodes

const inTable = (parent: PMNode) => /cell/.test(parent.type.spec.tableRole ?? '')

/** Typing the closing `]]` of `[[Link]]` turns it into a wiki link (extended syntax only). */
export const wikiLinkInputRule = new InputRule(/\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
  const $start = state.doc.resolve(start)
  if (!wikiLinksOn() || $start.parent.type.spec.code) return null
  // in a table cell the `|` before the text must be `\|`, else it splits the cell
  const { path, heading, alias } = parseWiki(match[1])
  const raw = inTable($start.parent) ? wikiRaw(heading ? `${path}#${heading}` : path, alias, true) : match[1]
  return state.tr.replaceWith(start, end, S.wikilink.create({ raw }, null, $start.marks()))
})

/** A wiki link shows its text, and its target as tooltip. */
export const wikiLinkView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('a')
  dom.className = 'wikilink'
  const render = (raw: string) => {
    dom.dataset.wikilink = raw
    dom.setAttribute('href', wikiHref(raw))
    dom.textContent = wikiDisplay(raw)
    dom.title = `[[${raw}]] – ${t('wiki.hint')}`
  }
  render(node.attrs.raw)
  dom.ondblclick = (e) => {
    e.preventDefault()
    void editWikiLink(view, getPos()!)
  }
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false
      render(n.attrs.raw)
      return true
    },
  }
}

async function editWikiLink(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== S.wikilink) return
  const { path, heading, alias } = parseWiki(node.attrs.raw)
  const target = heading ? `${path}#${heading}` : path
  const res = await openDialog({
    title: t('wiki.title'),
    fields: [
      { name: 'target', label: t('wiki.target'), value: target, placeholder: 'sub/Link#…' },
      { name: 'text', label: t('wiki.text'), value: alias ?? '' },
    ],
  })
  view.focus()
  if (!res) return
  const tr = view.state.tr
  if (!res.values.target.trim()) tr.delete(pos, pos + node.nodeSize)
  else tr.setNodeMarkup(pos, null, { raw: wikiRaw(res.values.target, res.values.text || null, inTable(view.state.doc.resolve(pos).parent)) })
  view.dispatch(tr)
}

// ------------------------------------------------------------------ targets that do not exist

const exists = new Map<string, boolean>() // absolute path → there?
/** Sent on `window` when the files a wiki link can find by name changed. */
export const WIKI_INDEX_EVENT = 'mod-wiki-index'
const key = new PluginKey<DecorationSet>('wikilinks')

/** The file a wiki link means, from the document's folder (`/…`: as written). */
function resolve(docPath: string | null, path: string): string | null {
  const file = wikiFile(path)
  if (host.isFileSystemAbsolute(file)) return file
  return docPath ? host.joinPath(host.dirname(docPath), file) : null
}

function decorations(state: EditorState, docPath: string | null, wanted: Set<string>, byName: (path: string) => string | null): DecorationSet {
  const decos: Decoration[] = []
  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type !== S.wikilink) return true
    const { path, heading } = parseWiki(node.attrs.raw)
    let missing = false
    if (!path) missing = !!heading && !findAnchor(state.doc, heading) // [[#Heading]] in this document
    else {
      const file = resolve(docPath, path)
      if (file) {
        const there = exists.get(file)
        if (there === undefined) wanted.add(file)
        // not next to the document: maybe somewhere in the workspace (by name)
        missing = there === false && !byName(path)
      }
    }
    if (missing) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wikilink-missing' }))
    return false
  })
  return DecorationSet.create(state.doc, decos)
}

/** `docPath`: the open document (relative targets are looked up from its folder); `byName`: in the workspace. */
export function wikiLinkPlugin(docPath: () => string | null, byName: (path: string) => string | null) {
  const wanted = new Set<string>()
  let timer = 0
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => decorations(state, docPath(), wanted, byName),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(key) ? decorations(state, docPath(), wanted, byName) : old.map(tr.mapping, tr.doc)),
    },
    props: { decorations: (state) => key.getState(state) },
    view(view) {
      const refresh = () => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
      const check = () => {
        clearTimeout(timer)
        if (!wanted.size) return
        timer = window.setTimeout(async () => {
          const files = [...wanted]
          wanted.clear()
          const found = await Promise.all(files.map((f) => host.fileHash(f).then((h) => h !== null, () => true)))
          files.forEach((f, i) => exists.set(f, found[i]))
          refresh()
        }, 200)
      }
      // files appear and disappear outside: look again when the window is used again
      const onFocus = () => {
        exists.clear()
        refresh()
      }
      window.addEventListener('focus', onFocus)
      // the workspace's file list changed (see main.ts)
      window.addEventListener(WIKI_INDEX_EVENT, refresh)
      check()
      return {
        update: check,
        destroy: () => {
          clearTimeout(timer)
          window.removeEventListener('focus', onFocus)
          window.removeEventListener(WIKI_INDEX_EVENT, refresh)
        },
      }
    },
  })
}
