// Markdown document <-> ProseMirror document with lossless round-trip.
//
// Pipeline:  text --micromark--> mdast --MdastToPM--> ProseMirror
//            ProseMirror --toMdast--> mdast --to-markdown--> text
//
// Round-trip guarantee: every top-level block (and every item of a top-level
// list) remembers its original source slice, the whitespace gap before it and
// its canonical serialization at load time. On export, a block whose
// serialization still equals that canonical form is unchanged, so its original
// bytes are written back. Only edited blocks are re-serialized.
// => import+export of an untouched file is byte-identical, and repeated
//    import/export cycles are stable.

import type { Node as PMNode } from 'prosemirror-model'
import type * as M from 'mdast'
import { schema } from './schema'
import { parseMarkdown, stringifyMarkdown } from './markdown'
import { MdastToPM, collectDefinitions, groupCenters } from './fromMdast'
import { blockToMdast, listItemToMdast } from './toMdast'

export interface DocMeta {
  /** Whitespace before the first block. */
  lead: string
  /** Whitespace after the last block (usually the final newline). */
  trail: string
}

export const NEW_DOC_META: DocMeta = { lead: '', trail: '\n' }

export interface Imported {
  doc: PMNode
  meta: DocMeta
}

/** Start of the line containing `offset`, if only spaces/tabs precede it. */
function lineStart(text: string, offset: number, floor: number): number {
  let i = offset
  while (i > floor && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--
  return i === floor || text[i - 1] === '\n' ? i : offset
}

function withAttrs(node: PMNode, attrs: Record<string, unknown>, content = node.content): PMNode {
  return node.type.create({ ...node.attrs, ...attrs }, content, node.marks)
}

export function importMarkdown(text: string, opts: { track?: boolean } = {}): Imported {
  const track = opts.track ?? true
  const tree = parseMarkdown(text)
  const conv = new MdastToPM(text, collectDefinitions(tree))
  // `<div align="center">` … `</div>` spans several mdast nodes but is one editor block
  const children = groupCenters(tree.children)

  if (!children.length) return { doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create()), meta: { lead: text, trail: '\n' } }

  const blocks: PMNode[] = []
  let prevEnd = 0
  let lead = ''
  children.forEach((child, i) => {
    const start = lineStart(text, child.position!.start.offset!, prevEnd)
    const end = child.position!.end.offset!
    let node = conv.block(child)
    if (i === 0) lead = text.slice(0, start)
    if (track) {
      if (child.type === 'list') node = trackListItems(node, child, text, start)
      node = withAttrs(node, { mdSrc: text.slice(start, end), mdIdx: i, mdGap: i === 0 ? null : text.slice(prevEnd, start) })
      node = withAttrs(node, { mdCanon: serializeBlock(node) })
    }
    blocks.push(node)
    prevEnd = end
  })
  return { doc: schema.nodes.doc.create(null, blocks), meta: { lead, trail: text.slice(prevEnd) } }
}

function trackListItems(list: PMNode, mdList: M.List, text: string, listStart: number): PMNode {
  const items: PMNode[] = []
  let prevEnd = listStart
  mdList.children.forEach((mdItem, j) => {
    const start = j === 0 ? listStart : lineStart(text, mdItem.position!.start.offset!, prevEnd)
    const end = mdItem.position!.end.offset!
    items.push(withAttrs(list.child(j), { mdSrc: text.slice(start, end), mdIdx: j, mdGap: j === 0 ? null : text.slice(prevEnd, start) }))
    prevEnd = end
  })
  const tracked = withAttrs(list, {}, schema.nodes.doc.create(null, items).content)
  return withAttrs(tracked, {}, fragmentWithCanon(tracked))
}

function fragmentWithCanon(list: PMNode) {
  const items: PMNode[] = []
  list.forEach((item, _, j) => items.push(withAttrs(item, { mdCanon: serializeListItem(list, item, j) })))
  return schema.nodes.doc.create(null, items).content
}

// ------------------------------------------------------------------ export

export function serializeBlock(node: PMNode): string {
  const children = blockToMdast(node)
  return children.length ? stringifyMarkdown({ type: 'root', children }) : ''
}

/** Serialize one item as it would appear at position `index` of `list`. */
function serializeListItem(list: PMNode, item: PMNode, index: number): string {
  const l = blockToMdast(list)[0] as M.List
  if (l.ordered) l.start = (l.start ?? 1) + (list.attrs.increment ? index : 0)
  l.children = [listItemToMdast(item)]
  return stringifyMarkdown(l)
}

const isList = (n: PMNode | null) => n?.type.name === 'bullet_list' || n?.type.name === 'ordered_list'
const listMarker = (n: PMNode) => (n.type.name === 'bullet_list' ? n.attrs.bullet : n.attrs.delim)
const altMarker = (n: PMNode) =>
  n.type.name === 'bullet_list' ? { bullet: n.attrs.bullet === '-' ? '*' : '-' } : { delim: n.attrs.delim === '.' ? ')' : '.' }
const isEmptyParagraph = (n: PMNode) => n.type.name === 'paragraph' && n.childCount === 0
const adjacent = (prev: PMNode | null, cur: PMNode) =>
  prev !== null && cur.attrs.mdGap !== null && prev.attrs.mdIdx !== null && prev.attrs.mdIdx === cur.attrs.mdIdx - 1

function emitList(list: PMNode, preserve: boolean): string {
  let out = ''
  let prev: PMNode | null = null
  list.forEach((item, _, j) => {
    const s = serializeListItem(list, item, j)
    const unchanged = preserve && item.attrs.mdSrc !== null && s === item.attrs.mdCanon
    if (j > 0) out += preserve && adjacent(prev, item) ? item.attrs.mdGap : list.attrs.spread ? '\n\n' : '\n'
    out += unchanged ? item.attrs.mdSrc : s
    prev = item
  })
  return out
}

function emitBlock(node: PMNode, preserve: boolean): string {
  const s = serializeBlock(node)
  if (!preserve || node.attrs.mdSrc === null) return s
  if (s === node.attrs.mdCanon) return node.attrs.mdSrc
  return isList(node) ? emitList(node, true) : s
}

export function exportMarkdown(doc: PMNode, meta: DocMeta = NEW_DOC_META, opts: { preserve?: boolean } = {}): string {
  const preserve = opts.preserve ?? true
  let body = ''
  let prev: PMNode | null = null
  doc.forEach((original) => {
    let node = original
    if (isEmptyParagraph(node)) return // Markdown has no empty paragraphs
    const keepGap = preserve && adjacent(prev, node)

    // Two lists of the same kind separated only by blank lines would merge.
    if (!keepGap && isList(prev) && prev!.type === node.type && listMarker(prev!) === listMarker(node)) {
      node = withAttrs(node, { ...altMarker(node), mdSrc: null })
    }
    let out = emitBlock(node, preserve)
    // Indented code right after a list would become part of the list.
    if (!keepGap && isList(prev) && node.type.name === 'code_block' && /^( {4}|\t)/.test(out)) {
      out = serializeBlock(withAttrs(node, { indented: false, fence: node.attrs.fence ?? '`', mdSrc: null }))
    }
    if (prev) body += keepGap ? node.attrs.mdGap : '\n\n'
    body += out
    prev = node
  })
  if (!body) return meta.lead
  return meta.lead + body + meta.trail
}
