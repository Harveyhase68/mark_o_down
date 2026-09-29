// mdast -> ProseMirror.
//
// Style details that mdast drops (bullet char, `*` vs `_`, fence char, …) are
// recovered from the original source text via node positions and kept as
// node/mark attributes, so re-serialized blocks keep their original style.

import type { Mark, Node as PMNode } from 'prosemirror-model'
import type * as M from 'mdast'
import { HTML_TAG_MARKS, schema } from './schema'
import { parseMarkdown, stringifyMarkdown } from './markdown'
import { A_CLOSE, A_OPEN, BR, IMG, tagAttrs, tokenizeImageHtml, type HtmlToken } from './htmlTags'

const S = schema.nodes
const K = schema.marks

/** `<sup>` / `<sub>` / `<mark>` opening tag (inline HTML) → the tag name. */
const TAG_OPEN = /^<(sup|sub|mark)(?:\s[^<>]*)?>$/i
const tagClose = (tag: string) => new RegExp(`^</${tag}\\s*>$`, 'i')

const CENTER_OPEN = /^<div\s+align\s*=\s*(["']?)center\1\s*>$/i
const CENTER_CLOSE = /^<\/div\s*>$/i
const CENTER_BLOCK = /^(<div\s+align\s*=\s*(?:"center"|'center'|center)\s*>)\s*([\s\S]*?)\s*(<\/div\s*>)$/i

/** `<div align="center">`, blocks…, `</div>` (separated by blank lines) as one unit. */
export interface CenterGroup {
  type: 'mdoCenter'
  open: string
  close: string
  children: M.RootContent[]
  position: NonNullable<M.Node['position']>
}

export type Unit = M.RootContent | CenterGroup

/** Find `<div align="center">` … `</div>` html-node pairs and group what's between. */
export function groupCenters(nodes: M.RootContent[]): Unit[] {
  const out: Unit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const open = nodes[i]
    if (open.type === 'html' && CENTER_OPEN.test(open.value.trim())) {
      let depth = 0
      let j = i + 1
      for (; j < nodes.length; j++) {
        const n = nodes[j]
        if (n.type !== 'html') continue
        const v = n.value.trim()
        if (CENTER_CLOSE.test(v)) {
          if (depth === 0) break
          depth--
        } else if (/^<div\b/i.test(v) && !/<\/div\s*>$/i.test(v)) depth++
      }
      if (j < nodes.length) {
        const close = nodes[j] as M.Html
        out.push({
          type: 'mdoCenter',
          open: open.value.trim(),
          close: close.value.trim(),
          children: nodes.slice(i + 1, j),
          position: { start: open.position!.start, end: close.position!.end },
        })
        i = j
        continue
      }
    }
    out.push(open)
  }
  return out
}

function imageFromTag(tag: string, marks: readonly Mark[] = []): PMNode {
  const a = tagAttrs(tag)
  return S.image.create({ src: a.src ?? '', alt: a.alt ?? '', title: a.title ?? null, html: tag }, null, marks)
}

/** Tokens of an img/br/a-only HTML block → inline nodes (whitespace with a newline → soft break). */
function htmlTokensToInline(tokens: HtmlToken[]): PMNode[] {
  const out: PMNode[] = []
  let marks: readonly Mark[] = []
  for (const t of tokens) {
    if (t.kind === 'img') out.push(imageFromTag(t.tag, marks))
    else if (t.kind === 'br') out.push(S.hard_break.create({ html: t.tag }, null, marks))
    else if (t.kind === 'a') {
      const a = tagAttrs(t.tag)
      marks = [K.link.create({ href: a.href ?? '', title: a.title ?? null, html: t.tag })]
    } else if (t.kind === '/a') marks = []
    else if (out.length || marks.length) out.push(t.text.includes('\n') ? S.soft_break.create(null, null, marks) : schema.text(' ', marks))
  }
  // trailing whitespace outside a link is meaningless
  const last = () => out[out.length - 1]
  while (out.length && !last().marks.length && (last().type === S.soft_break || last().text === ' ')) out.pop()
  return out
}

function dedent(text: string): string {
  const lines = text.split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length))
  return Number.isFinite(indent) && indent > 0 ? lines.map((l) => l.slice(indent)).join('\n') : text
}

export interface Definitions {
  [identifier: string]: { url: string; title: string | null }
}

export class MdastToPM {
  constructor(
    private src: string,
    private defs: Definitions,
  ) {}

  private slice(node: M.Nodes): string {
    const p = node.position
    return p?.start.offset !== undefined && p.end.offset !== undefined ? this.src.slice(p.start.offset, p.end.offset) : ''
  }

  private firstChar(node: M.Nodes): string {
    const off = node.position?.start.offset
    return off === undefined ? '' : this.src.charAt(off)
  }

  // ---------------------------------------------------------------- blocks

  blocks(nodes: M.RootContent[] | M.BlockContent[] | M.DefinitionContent[]): PMNode[] {
    return groupCenters(nodes as M.RootContent[]).map((n) => this.block(n))
  }

  block(node: Unit): PMNode {
    switch (node.type) {
      case 'mdoCenter':
        return S.center.create({ open: node.open, close: node.close }, this.containerContent(node.children))

      case 'html':
        return this.htmlBlock(node)

      case 'table':
        return this.table(node)

      case 'paragraph':
        return S.paragraph.create(null, this.inlines(node.children))

      case 'heading': {
        const src = this.slice(node)
        const setext = src !== '' && !/^ {0,3}#/.test(src)
        const closeAtx = !setext && /[ \t]#+[ \t]*$/.test(src.split('\n')[0])
        return S.heading.create({ level: node.depth, setext, closeAtx }, this.inlines(node.children))
      }

      case 'blockquote':
        return S.blockquote.create(null, this.containerContent(node.children))

      case 'thematicBreak': {
        const src = this.slice(node).trim()
        const rule = (src.charAt(0) || '-') as '*' | '-' | '_'
        const repeat = src.split('').filter((c) => c === rule).length || 3
        return S.horizontal_rule.create({ rule, repeat, spaces: /\s/.test(src) })
      }

      case 'code': {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(this.slice(node))
        const text = node.value ? schema.text(node.value) : null
        return S.code_block.create(
          { lang: node.lang ?? null, meta: node.meta ?? null, fence: fenceMatch ? fenceMatch[1].charAt(0) : null, indented: !fenceMatch && this.slice(node) !== '' },
          text,
        )
      }

      case 'list':
        return this.list(node)

      case 'footnoteDefinition':
        return S.footnote_def.create({ label: node.label ?? node.identifier }, this.containerContent(node.children as M.RootContent[]))

      default:
        return this.raw(node)
    }
  }

  private containerContent(children: M.RootContent[]): PMNode[] {
    const out = this.blocks(children)
    return out.length ? out : [S.paragraph.create()]
  }

  private list(node: M.List): PMNode {
    const first = node.children[0]
    const firstSrc = first ? this.slice(first) : ''
    const m = /^([-*+]|(\d{1,9})([.)]))([ \t]*)/.exec(firstSrc)
    const markerWidth = m ? m[1].length : 1
    const gap = m ? m[4].length : 1
    const indent = gap > 1 && (markerWidth + gap) % 4 === 0 ? 'tab' : 'one'
    const items = node.children.map((item) =>
      S.list_item.create({ checked: item.checked ?? null, spread: !!item.spread }, this.containerContent(item.children as M.RootContent[])),
    )
    const spread = !!node.spread
    if (node.ordered) {
      const second = node.children[1] ? /^(\d{1,9})/.exec(this.slice(node.children[1])) : null
      const start = node.start ?? 1
      return S.ordered_list.create(
        { start, delim: m?.[3] ?? '.', increment: second ? Number(second[1]) !== start : true, spread, indent },
        items,
      )
    }
    return S.bullet_list.create({ bullet: m?.[1] ?? '-', spread, indent }, items)
  }

  private htmlBlock(node: M.Html): PMNode {
    const value = node.value
    // `<br>` on its own line: an empty line in the rendered output
    if (BR.test(value)) return S.paragraph.create(null, S.hard_break.create({ html: value }))
    // `<div align="center">…</div>` written as one HTML block (no blank lines):
    // its inside is edited as Markdown and written back in the blank-line form.
    const m = CENTER_BLOCK.exec(value)
    if (m && !/<\/?div\b/i.test(m[2])) {
      const inner = dedent(m[2])
      const conv = new MdastToPM(inner, this.defs)
      return S.center.create({ open: m[1], close: m[3] }, conv.containerContent(parseMarkdown(inner).children))
    }
    // only <img>/<br>/<a> tags (logos, preview images): shown as real images
    const tokens = tokenizeImageHtml(value)
    if (tokens) return S.paragraph.create({ htmlBlock: true }, htmlTokensToInline(tokens))
    return this.raw(node)
  }

  private table(node: M.Table): PMNode {
    const lines = this.slice(node).split('\n').map((l) => l.trim())
    // Keep the original style: aligned `| --- |` (all rows equally long) vs. compact `|---|---|`
    const pipeAlign = lines.length >= 2 && / /.test(lines[1]) && lines.every((l) => l.length === lines[0].length)
    // GFM: the header defines the columns; extra cells are ignored, missing ones are empty
    const cols = node.align?.length || node.children[0]?.children.length || 1
    const rows = node.children.map((row, r) => {
      const type = r === 0 ? S.table_header : S.table_cell
      const cells: PMNode[] = []
      for (let c = 0; c < cols; c++) {
        const cell = row.children[c]
        cells.push(type.create({ align: node.align?.[c] ?? null }, cell ? this.inlines(cell.children) : null))
      }
      return S.table_row.create(null, cells)
    })
    return S.table.create({ pipeAlign }, rows)
  }

  /** Anything we don't edit structurally becomes raw Markdown text. */
  private raw(node: M.RootContent): PMNode {
    const text = node.type === 'html' ? node.value : stringifyMarkdown(node)
    return S.raw_block.create({ kind: node.type }, text ? schema.text(text) : null)
  }

  // ---------------------------------------------------------------- inlines

  inlines(nodes: M.PhrasingContent[], marks: readonly Mark[] = []): PMNode[] {
    const out: PMNode[] = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      // `<a href="…">` … `</a>` as inline HTML: a link (usually around an <img>)
      if (node.type === 'html' && A_OPEN.test(node.value)) {
        const end = nodes.findIndex((n, j) => j > i && n.type === 'html' && (A_CLOSE.test(n.value) || A_OPEN.test(n.value)))
        const close = nodes[end]
        if (end > i + 1 && close.type === 'html' && A_CLOSE.test(close.value)) {
          const a = tagAttrs(node.value)
          const link = K.link.create({ href: a.href ?? '', title: a.title ?? null, html: node.value })
          for (const inner of nodes.slice(i + 1, end)) this.inline(inner, link.addToSet(marks), out)
          i = end
          continue
        }
      }
      // `<sup>` … `</sup>` (also sub, mark): formatting, as long as the pair is in one place
      const tag = node.type === 'html' ? TAG_OPEN.exec(node.value)?.[1].toLowerCase() : undefined
      if (tag) {
        const close = tagClose(tag)
        const end = nodes.findIndex((n, j) => j > i && n.type === 'html' && close.test(n.value))
        const nested = nodes.slice(i + 1, end).some((n) => n.type === 'html' && TAG_OPEN.exec(n.value)?.[1].toLowerCase() === tag)
        if (end > i + 1 && !nested) {
          const mark = K[HTML_TAG_MARKS[tag]].create({ open: (node as M.Html).value, close: (nodes[end] as M.Html).value })
          out.push(...this.inlines(nodes.slice(i + 1, end), mark.addToSet(marks)))
          i = end
          continue
        }
      }
      this.inline(node, marks, out)
    }
    return out
  }

  private inline(node: M.PhrasingContent, marks: readonly Mark[], out: PMNode[]): void {
    switch (node.type) {
      case 'text':
        node.value.split('\n').forEach((part, i) => {
          if (i) out.push(S.soft_break.create(null, null, marks))
          if (part) out.push(schema.text(part, marks))
        })
        return
      case 'inlineCode':
        if (node.value) out.push(schema.text(node.value, K.code.create().addToSet(marks)))
        else out.push(S.raw_inline.create({ value: this.slice(node) || '``' }, null, marks))
        return
      case 'emphasis':
        return this.wrap(node.children, K.em.create({ marker: this.firstChar(node) === '_' ? '_' : '*' }), marks, out)
      case 'strong':
        return this.wrap(node.children, K.strong.create({ marker: this.firstChar(node) === '_' ? '_' : '*' }), marks, out)
      case 'delete':
        return this.wrap(node.children, K.strike.create(), marks, out)
      case 'link': {
        const c = this.firstChar(node)
        const literal = c !== '[' && c !== '<'
        const attrs = { href: node.url, title: node.title ?? null, literal, nest: nesting(node, marks) }
        return this.wrap(node.children, K.link.create(attrs), marks, out)
      }
      case 'linkReference': {
        const def = this.defs[node.identifier]
        const ref = { identifier: node.identifier, label: node.label ?? node.identifier, referenceType: node.referenceType }
        return this.wrap(node.children, K.link.create({ href: def?.url ?? '', title: def?.title ?? null, ref, nest: nesting(node, marks) }), marks, out)
      }
      case 'image':
        out.push(S.image.create({ src: node.url, alt: node.alt ?? '', title: node.title ?? null }, null, marks))
        return
      case 'imageReference': {
        const def = this.defs[node.identifier]
        const ref = { identifier: node.identifier, label: node.label ?? node.identifier, referenceType: node.referenceType }
        out.push(S.image.create({ src: def?.url ?? '', alt: node.alt ?? '', title: def?.title ?? null, ref }, null, marks))
        return
      }
      case 'break':
        out.push(S.hard_break.create({ spaces: this.firstChar(node) !== '\\' }, null, marks))
        return
      case 'footnoteReference':
        out.push(S.footnote_ref.create({ label: node.label ?? node.identifier }, null, marks))
        return
      case 'html':
        if (BR.test(node.value)) out.push(S.hard_break.create({ html: node.value }, null, marks))
        else if (IMG.test(node.value)) out.push(imageFromTag(node.value, marks))
        else out.push(S.raw_inline.create({ value: node.value }, null, marks))
        return
      default: {
        // anything else: keep verbatim
        const value = this.slice(node) || stringifyMarkdown({ type: 'paragraph', children: [node] })
        out.push(S.raw_inline.create({ value }, null, marks))
      }
    }
  }

  private wrap(children: M.PhrasingContent[], mark: Mark, marks: readonly Mark[], out: PMNode[]) {
    const inner = mark.addToSet(marks)
    const before = out.length
    out.push(...this.inlines(children, inner))
    // Empty emphasis/link like `[](url)`: keep as raw so it survives.
    if (out.length === before) out.push(S.raw_inline.create({ value: '' }, null, inner))
  }
}

const FORMATTING = new Set(['em', 'strong', 'strike'])
const FORMATTING_MDAST = new Set(['emphasis', 'strong', 'delete'])

/** Remember whether formatting wrapped the link (`*[a](u)*` → inner) or sat inside it (`[*a*](u)` → outer). */
function nesting(node: M.Link | M.LinkReference, marks: readonly Mark[]): 'inner' | 'outer' | null {
  if (marks.some((m) => FORMATTING.has(m.type.name))) return 'inner'
  return node.children.some((c) => FORMATTING_MDAST.has(c.type)) ? 'outer' : null
}

export function collectDefinitions(tree: M.Root): Definitions {
  const defs: Definitions = {}
  const visit = (n: M.Nodes) => {
    if (n.type === 'definition' && !(n.identifier in defs)) defs[n.identifier] = { url: n.url, title: n.title ?? null }
    if ('children' in n) for (const c of n.children) visit(c as M.Nodes)
  }
  visit(tree)
  return defs
}
