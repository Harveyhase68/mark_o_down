// ProseMirror -> mdast.
//
// ProseMirror stores inline formatting as flat marks, mdast as nested nodes;
// `phrasing()` rebuilds the nesting. Style attrs go to `data.mdo` for the
// serializer (see markdown.ts).

import type { Mark, Node as PMNode } from 'prosemirror-model'
import type * as M from 'mdast'
import type { StyleHints } from './markdown'
import { schema } from './schema'
import { setTagAttr, tagAttrs } from './htmlTags'

const mdo = (h: StyleHints) => ({ mdo: Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null && v !== undefined)) })

/** One editor block → mdast flow nodes (usually one; a centered block is three). */
export function blockToMdast(node: PMNode): M.RootContent[] {
  const one = blockNode(node)
  if (one) return [one]
  if (node.type.name === 'center') return [centerTag(node.attrs.open), ...flow(node), centerTag(node.attrs.close)]
  return []
}

/** `<div align="center">` / `</div>`: always surrounded by blank lines (see markdown.ts join). */
const centerTag = (value: string): M.Html => ({ type: 'html', value, data: mdo({ centerTag: true }) }) as M.Html

function blockNode(node: PMNode): M.RootContent | null {
  const a = node.attrs
  switch (node.type.name) {
    case 'center':
      return null
    case 'paragraph': {
      // still only HTML tags + whitespace → keep it an HTML block (a paragraph would add <p>)
      const html = a.htmlBlock ? htmlBlockValue(node) : null
      return html !== null ? { type: 'html', value: html } : { type: 'paragraph', children: phrasing(node) }
    }
    case 'heading':
      return { type: 'heading', depth: a.level, children: phrasing(node), data: mdo({ setext: a.setext || undefined, closeAtx: a.closeAtx || undefined }) } as M.Heading
    case 'blockquote':
      return { type: 'blockquote', children: flow(node) as M.BlockContent[] }
    case 'horizontal_rule':
      return { type: 'thematicBreak', data: mdo({ rule: a.rule, repeat: a.repeat, spaces: a.rule ? a.spaces : undefined }) } as M.ThematicBreak
    case 'code_block':
      return {
        type: 'code',
        lang: a.lang || null,
        meta: a.meta || null,
        value: node.textContent,
        data: mdo({ fence: a.fence, indented: a.indented && !a.lang ? true : a.fence ? false : undefined }),
      } as M.Code
    case 'raw_block':
      return node.textContent ? { type: 'html', value: node.textContent } : null
    case 'bullet_list':
    case 'ordered_list':
      return { ...listShell(node), children: items(node) }
    case 'table':
      return table(node)
    case 'math_block':
      return a.fence
        ? ({ type: 'code', lang: 'math', meta: null, value: node.textContent, data: mdo({ fence: a.fence }) } as M.Code)
        : ({ type: 'math', meta: a.meta || null, value: node.textContent } as M.RootContent)
    case 'footnote_def':
      return { type: 'footnoteDefinition', identifier: footnoteId(a.label), label: a.label, children: flow(node) as M.BlockContent[] }
    default:
      throw new Error(`Unknown block node: ${node.type.name}`)
  }
}

/** mdast identifier of a footnote label (normalized like CommonMark labels). */
const footnoteId = (label: string) => label.replace(/\s+/g, ' ').trim().toLowerCase()

export function flow(node: PMNode): M.RootContent[] {
  const out: M.RootContent[] = []
  node.forEach((child) => {
    // Markdown has no empty paragraphs; keep one only if it's the sole child.
    if (child.type.name === 'paragraph' && !child.childCount && node.childCount > 1) return
    out.push(...blockToMdast(child))
  })
  return out
}

/** A list node with its style but without items. */
export function listShell(list: PMNode): M.List {
  const a = list.attrs
  return list.type.name === 'ordered_list'
    ? ({ type: 'list', ordered: true, start: a.start, spread: a.spread, children: [], data: mdo({ delim: a.delim, increment: a.increment, indent: a.indent }) } as M.List)
    : ({ type: 'list', ordered: false, spread: a.spread, children: [], data: mdo({ bullet: a.bullet, indent: a.indent }) } as M.List)
}

export function listItemToMdast(item: PMNode): M.ListItem {
  const children = flow(item) as M.BlockContent[]
  return { type: 'listItem', checked: item.attrs.checked, spread: item.attrs.spread, children }
}

function items(list: PMNode): M.ListItem[] {
  const out: M.ListItem[] = []
  list.forEach((item) => out.push(listItemToMdast(item)))
  return out
}

function table(node: PMNode): M.Table {
  const rows: M.TableRow[] = []
  node.forEach((row) => {
    const cells: M.TableCell[] = []
    row.forEach((cell) => cells.push({ type: 'tableCell', children: phrasing(cell, true) }))
    rows.push({ type: 'tableRow', children: cells })
  })
  // alignment lives on the cells (survives adding/removing columns); the header row is authoritative
  const align: M.AlignType[] = []
  node.firstChild?.forEach((cell) => align.push(cell.attrs.align ?? null))
  return { type: 'table', align, children: rows, data: mdo({ pipeAlign: node.attrs.pipeAlign }) } as M.Table
}

// ------------------------------------------------------------------ inline

interface Item {
  node: PMNode
  text?: string
  marks: readonly Mark[] // without `code`
  code: boolean
}

// Whitespace may stay inside HTML tags like `<a>` or `<sup>` (only Markdown delimiters care about it).
const HTML_MARKS = new Set(['sup', 'sub', 'highlight'])
const isHtmlMark = (m: Mark) => HTML_MARKS.has(m.type.name) || (m.type.name === 'link' && !!m.attrs.html)
const intersect = (a: readonly Mark[], b: readonly Mark[]) => a.filter((m) => isHtmlMark(m) || b.some((n) => n.eq(m)))

/** Move leading/trailing whitespace out of formatting: `** a **` is not bold in Markdown. */
function normalizeWhitespace(list: Item[]): Item[] {
  const out: Item[] = []
  list.forEach((it, i) => {
    if (it.text === undefined || it.code || !it.marks.length) return void out.push(it)
    const prev = list[i - 1]?.marks ?? []
    const next = list[i + 1]?.marks ?? []
    const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(it.text)!
    if (!body) return void out.push({ ...it, marks: intersect(it.marks, intersect(prev, next)) })
    if (lead) out.push({ ...it, text: lead, marks: intersect(it.marks, prev) })
    out.push({ ...it, text: body })
    if (trail) out.push({ ...it, text: trail, marks: intersect(it.marks, next) })
  })
  return out
}

function markToParent(mark: Mark): M.Parent & M.PhrasingContent {
  const a = mark.attrs
  switch (mark.type.name) {
    case 'link':
      if (a.html) return { type: 'mdoHtmlTag', open: syncTag(a.html, { href: a.href, title: a.title }), close: '</a>', children: [] } as unknown as M.Link
      return a.ref
        ? { type: 'linkReference', identifier: a.ref.identifier, label: a.ref.label, referenceType: a.ref.referenceType, children: [] }
        : ({ type: 'link', url: a.href, title: a.title || null, children: [], data: mdo({ literal: a.literal || undefined }) } as M.Link)
    case 'strong':
      return { type: 'strong', children: [], data: mdo({ marker: a.marker }) } as M.Strong
    case 'em':
      return { type: 'emphasis', children: [], data: mdo({ marker: a.marker }) } as M.Emphasis
    case 'strike':
      return { type: 'delete', children: [] }
    case 'sup':
    case 'sub':
    case 'highlight':
      return { type: 'mdoHtmlTag', open: a.open, close: a.close, children: [] } as unknown as M.Link
    default:
      throw new Error(`Unknown mark: ${mark.type.name}`)
  }
}

/** On equal extent: a link marked `outer` goes outside formatting, otherwise schema order. */
const MARK_ORDER = Object.keys(schema.marks)
const tieRank = (m: Mark) => (m.type.name === 'link' && m.attrs.nest === 'outer' ? -1 : MARK_ORDER.indexOf(m.type.name))

/** `inTable`: Markdown line breaks can't exist in a table cell, so breaks become `<br>`. */
export function phrasing(parent: PMNode, inTable = false): M.PhrasingContent[] {
  let list: Item[] = []
  parent.forEach((node) => {
    const code = node.marks.some((m) => m.type.name === 'code')
    const text = node.isText ? node.text! : node.type.name === 'soft_break' ? '\n' : undefined
    list.push({ node, text, marks: node.marks.filter((m) => m.type.name !== 'code'), code })
  })
  // A trailing Markdown hard break is not expressible (an HTML `<br>` is).
  const isMdBreak = (it: Item) => it.node.type.name === 'hard_break' && !it.node.attrs.html && !inTable
  while (list.length && isMdBreak(list[list.length - 1])) list.pop()
  list = normalizeWhitespace(list)

  const root: M.PhrasingContent[] = []
  const stack: { mark: Mark; children: M.PhrasingContent[] }[] = []
  const container = () => (stack.length ? stack[stack.length - 1].children : root)

  // How many consecutive items starting at `i` carry `mark`.
  const extent = (mark: Mark, i: number) => {
    let j = i
    while (j < list.length && mark.isInSet(list[j].marks)) j++
    return j - i
  }

  list.forEach((it, i) => {
    // Keep marks that are already open first so we don't close/reopen needlessly;
    // open new ones widest-first (`**[a](u) b**` → strong outside the link).
    const open = stack.map((s) => s.mark)
    const fresh = it.marks.filter((m) => !open.some((n) => n.eq(m)))
    const widths = new Map(fresh.map((m) => [m, extent(m, i)]))
    fresh.sort((a, b) => widths.get(b)! - widths.get(a)! || tieRank(a) - tieRank(b))
    const wanted = [...open.filter((m) => it.marks.some((n) => n.eq(m))), ...fresh]
    let keep = 0
    while (keep < stack.length && keep < wanted.length && stack[keep].mark.eq(wanted[keep])) keep++
    stack.length = keep
    for (const mark of wanted.slice(keep)) {
      const p = markToParent(mark)
      container().push(p)
      stack.push({ mark, children: p.children as M.PhrasingContent[] })
    }

    const c = container()
    const last = c[c.length - 1]
    const a = it.node.attrs
    switch (it.node.type.name) {
      case 'text':
      case 'soft_break':
        if (it.code) {
          if (last?.type === 'inlineCode') last.value += it.text
          else c.push({ type: 'inlineCode', value: it.text! })
        } else if (last?.type === 'text') last.value += it.text
        else c.push({ type: 'text', value: it.text! })
        break
      case 'image':
        if (a.html) c.push({ type: 'html', value: syncTag(a.html, { src: a.src, alt: a.alt, title: a.title }) })
        else
          c.push(
            a.ref
              ? { type: 'imageReference', identifier: a.ref.identifier, label: a.ref.label, referenceType: a.ref.referenceType, alt: a.alt || null }
              : { type: 'image', url: a.src, alt: a.alt || null, title: a.title || null },
          )
        break
      case 'hard_break':
        if (a.html || inTable) c.push({ type: 'html', value: a.html ?? '<br>' })
        else c.push({ type: 'break', data: mdo({ spaces: a.spaces || undefined }) } as M.Break)
        break
      case 'raw_inline':
        c.push({ type: 'html', value: a.value })
        break
      case 'footnote_ref':
        c.push({ type: 'footnoteReference', identifier: footnoteId(a.label), label: a.label })
        break
      case 'math_inline':
        c.push({ type: 'inlineMath', value: a.tex } as M.PhrasingContent)
        break
      default:
        throw new Error(`Unknown inline node: ${it.node.type.name}`)
    }
  })
  const out = expandHtmlTags(root)
  // dollars that can't form a formula ("from $5 to $10", see md/math.ts) need no escaping
  if (!couldFormMath(list.map((it) => (it.text !== undefined && !it.code ? it.text : ' ')).join(''))) markPlainDollars(out)
  return out
}

/** Could these `$` be read as math? `$$…$$`, or `$x$` by Pandoc's rule (see md/math.ts). */
export function couldFormMath(text: string): boolean {
  return /\$\$[^]*\$\$/.test(text) || /(?<!\$)\$(?=[^\s$])[^]*?(?<=[^\s$])\$(?![$\d])/.test(text)
}

function markPlainDollars(nodes: M.PhrasingContent[]) {
  for (const n of nodes) {
    if (n.type === 'text' && n.value.includes('$')) n.data = { ...n.data, ...mdo({ plainDollars: true }) }
    if ('children' in n) markPlainDollars(n.children as M.PhrasingContent[])
  }
}

/**
 * A paragraph that came from an `<img>`/`<br>`/`<a>`-only HTML block, written
 * back tag by tag with its line breaks. null if it now holds anything else
 * (e.g. typed text or bold), then it is written as a Markdown paragraph.
 */
function htmlBlockValue(node: PMNode): string | null {
  let out = ''
  let link: Mark | null = null
  let ok = true
  node.forEach((child) => {
    if (!ok) return
    const l = child.marks.find((m) => m.type.name === 'link') ?? null
    if (child.marks.length > (l ? 1 : 0) || (l && !l.attrs.html)) return void (ok = false)
    if (link && !(l && l.eq(link))) {
      out += '</a>'
      link = null
    }
    if (l && !link) {
      out += syncTag(l.attrs.html, { href: l.attrs.href, title: l.attrs.title })
      link = l
    }
    const a = child.attrs
    if (child.type.name === 'image' && a.html) out += syncTag(a.html, { src: a.src, alt: a.alt, title: a.title })
    else if (child.type.name === 'hard_break') out += a.html ?? '<br>'
    else if (child.type.name === 'soft_break') out += '\n'
    else if (child.isText && !child.text!.trim()) out += child.text
    else ok = false
  })
  if (!ok) return null
  if (link) out += '</a>'
  return out
}

/**
 * Formatting written as HTML (`<a href>`, `<sup>`, `<mark>` …) is a temporary parent
 * while nesting marks; emit it as opening tag … closing tag.
 */
interface HtmlTag {
  type: 'mdoHtmlTag'
  open: string
  close: string
  children: M.PhrasingContent[]
}

function expandHtmlTags(nodes: M.PhrasingContent[]): M.PhrasingContent[] {
  const out: M.PhrasingContent[] = []
  for (const n of nodes as (M.PhrasingContent | HtmlTag)[]) {
    if (n.type === 'mdoHtmlTag') out.push({ type: 'html', value: n.open }, ...expandHtmlTags(n.children), { type: 'html', value: n.close })
    else {
      if ('children' in n) n.children = expandHtmlTags(n.children as M.PhrasingContent[]) as never
      out.push(n)
    }
  }
  return out
}

/** Write changed attributes back into the original tag; untouched tags stay byte-identical. */
function syncTag(tag: string, values: Record<string, string | null>): string {
  const current = tagAttrs(tag)
  for (const [name, value] of Object.entries(values)) {
    const v = value || null
    if ((current[name] ?? null) !== v && !(v === null && current[name] === '')) tag = setTagAttr(tag, name, v)
  }
  return tag
}

