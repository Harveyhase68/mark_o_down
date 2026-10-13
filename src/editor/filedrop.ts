// A file dragged from the folder tree into the document becomes a link to it, where it is
// dropped: `[[sub/Kapitel]]` with wiki links, else `[Kapitel](sub/Kapitel.md)` – relative to
// the document. A caret shows where it will go while dragging.

import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { schema } from '../md/schema'
import { wikiLinksOn } from '../md/markdown'
import { relativePath } from '../workspace'
import * as host from '../platform'

const S = schema.nodes
const K = schema.marks

export interface FileLink {
  /** the inside of [[…]] (null: a Markdown link) */
  wiki: string | null
  href: string
  text: string
  /** as Markdown text (in code blocks) */
  markdown: string
}

/**
 * The link from the document at `docPath` to `file`. Without a document path (not saved yet)
 * only a wiki link by name works, and only in a workspace (`byName`); else null.
 */
export function fileLink(file: string, docPath: string | null, byName: boolean): FileLink | null {
  const text = host.basename(file).replace(/\.[^.]+$/, '')
  const wiki = wikiLinksOn()
  let rel: string
  if (docPath) rel = relativePath(host.dirname(docPath), file)
  else if (byName && wiki) rel = host.basename(file)
  else return null
  const absolute = host.isFileSystemAbsolute(rel) // another drive
  const target = rel.replace(/\.md$/i, '')
  // characters a wiki link can't hold: a Markdown link then
  if (wiki && !absolute && !/[[\]|#^]/.test(target)) return { wiki: target, href: rel, text, markdown: `[[${target}]]` }
  const href = host.encodePath(absolute ? rel.replace(/\\/g, '/') : rel)
  return { wiki: null, href, text, markdown: `[${text}](${href})` }
}

/** The document position under the pointer (anywhere over the page), null outside it. */
export function dropPosition(view: EditorView, x: number, y: number): number | null {
  const page = (view.dom.closest('#scroller') ?? view.dom).getBoundingClientRect()
  if (x < page.left || x > page.right || y < page.top || y > page.bottom) return null
  const box = view.dom.getBoundingClientRect()
  const left = Math.min(Math.max(x, box.left + 1), box.right - 1)
  const top = Math.min(Math.max(y, box.top + 1), box.bottom - 1)
  return view.posAtCoords({ left, top })?.pos ?? null
}

/** The thin line where a dropped link will go. */
export function createDropCaret(view: EditorView) {
  const caret = document.createElement('div')
  caret.className = 'drop-caret'
  caret.hidden = true
  document.body.append(caret)
  return {
    show(pos: number) {
      const c = view.coordsAtPos(pos)
      caret.style.left = `${c.left - 1}px`
      caret.style.top = `${c.top}px`
      caret.style.height = `${Math.max(c.bottom - c.top, 14)}px`
      caret.hidden = false
    },
    hide() {
      caret.hidden = true
    },
  }
}

export function insertFileLink(view: EditorView, pos: number, link: FileLink) {
  const $pos = view.state.doc.resolve(pos)
  const tr = view.state.tr
  if ($pos.parent.type.spec.code) tr.insertText(link.markdown, pos)
  else {
    tr.setSelection(TextSelection.near($pos))
    const node = link.wiki !== null ? S.wikilink.create({ raw: link.wiki }) : schema.text(link.text, [K.link.create({ href: link.href })])
    // not glued to a word: a space before it, and after it unless punctuation follows
    const { $from, from: at } = tr.selection
    const char = (from: number, to: number) => $from.parent.textBetween(Math.max(0, from), Math.min($from.parent.content.size, to), undefined, '￼')
    const spaceBefore = !/^$|[\s([{«„"']/.test(char($from.parentOffset - 1, $from.parentOffset))
    const spaceAfter = !/^$|[\s.,;:!?)\]}»“"']/.test(char($from.parentOffset, $from.parentOffset + 1))
    tr.replaceSelectionWith(node, false)
    if (spaceAfter) tr.insertText(' ', at + node.nodeSize)
    if (spaceBefore) tr.insertText(' ', at)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}
