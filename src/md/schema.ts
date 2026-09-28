// ProseMirror schema: exactly the Markdown constructs we edit visually.
// Everything else (other HTML, footnotes, front matter, …) is kept as raw
// Markdown in `raw_block` / `raw_inline` so nothing is ever lost.
//
// Attributes prefixed with `md` are round-trip bookkeeping (original source,
// original serialization, original index, original gap); they are never shown.

import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model'

/** Source-tracking attrs for nodes whose original Markdown we may re-emit verbatim. */
const srcAttrs = {
  mdSrc: { default: null },
  mdCanon: { default: null },
  mdIdx: { default: null },
  mdGap: { default: null },
}

/** Table cell; colspan/rowspan/colwidth are required by prosemirror-tables (always 1/1/null in GFM). */
function cellSpec(tableRole: 'cell' | 'header_cell', tag: 'td' | 'th'): NodeSpec {
  return {
    content: 'inline*',
    tableRole,
    isolating: true,
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, align: { default: null } },
    parseDOM: [{ tag, getAttrs: (dom) => ({ align: (dom as HTMLElement).style.textAlign || (dom as HTMLElement).getAttribute('align') || null }) }],
    toDOM: (node) => [tag, node.attrs.align ? { style: `text-align: ${node.attrs.align}` } : {}, 0],
  }
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    // htmlBlock: came from an HTML block of only <img>/<br>/<a> tags; written back as HTML
    attrs: { htmlBlock: { default: false }, ...srcAttrs },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { level: { default: 1 }, setext: { default: false }, closeAtx: { default: false }, ...srcAttrs },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { ...srcAttrs },
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  // `<div align="center">` … `</div>` around Markdown content. The only HTML
  // container we edit visually; the exact original tags are kept in attrs.
  center: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { open: { default: '<div align="center">' }, close: { default: '</div>' }, ...srcAttrs },
    parseDOM: [{ tag: 'div[align=center]' }, { tag: 'center' }],
    toDOM: () => ['div', { class: 'center', align: 'center' }, 0],
  },

  // GFM table. Cells hold inline content (a Markdown cell is one line).
  table: {
    group: 'block',
    content: 'table_row+',
    tableRole: 'table',
    isolating: true,
    attrs: { pipeAlign: { default: false }, ...srcAttrs },
    parseDOM: [{ tag: 'table' }],
    toDOM: () => ['table', ['tbody', 0]],
  },

  table_row: {
    content: '(table_cell | table_header)*',
    tableRole: 'row',
    parseDOM: [{ tag: 'tr' }],
    toDOM: () => ['tr', 0],
  },

  table_header: cellSpec('header_cell', 'th'),
  table_cell: cellSpec('cell', 'td'),

  horizontal_rule: {
    group: 'block',
    attrs: { rule: { default: null }, repeat: { default: null }, spaces: { default: false }, ...srcAttrs },
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { lang: { default: null }, meta: { default: null }, fence: { default: null }, indented: { default: false }, ...srcAttrs },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (dom) => ((dom as HTMLElement).hasAttribute('data-raw') ? false : { lang: (dom as HTMLElement).getAttribute('data-lang') || null }),
      },
    ],
    toDOM: (node) => ['pre', { 'data-lang': node.attrs.lang || '' }, ['code', 0]],
  },

  // Markdown we don't edit structurally (table, html, footnote definition, …).
  // Its text *is* the Markdown source and is written back verbatim.
  raw_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { kind: { default: 'html' }, ...srcAttrs },
    parseDOM: [{ tag: 'pre[data-raw]', preserveWhitespace: 'full', getAttrs: (dom) => ({ kind: (dom as HTMLElement).getAttribute('data-raw') }) }],
    toDOM: (node) => ['pre', { 'data-raw': node.attrs.kind, class: 'raw-block' }, ['code', 0]],
  },

  bullet_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { bullet: { default: '-' }, spread: { default: false }, indent: { default: 'one' }, ...srcAttrs },
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },

  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { start: { default: 1 }, delim: { default: '.' }, increment: { default: true }, spread: { default: false }, indent: { default: 'one' }, ...srcAttrs },
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ start: Number((dom as HTMLElement).getAttribute('start') ?? 1) || 1 }) }],
    toDOM: (node) => ['ol', node.attrs.start === 1 ? {} : { start: node.attrs.start }, 0],
  },

  list_item: {
    content: 'block+',
    defining: true,
    attrs: { checked: { default: null }, spread: { default: false }, ...srcAttrs },
    parseDOM: [{ tag: 'li' }],
    toDOM: (node): DOMOutputSpec =>
      node.attrs.checked === null
        ? ['li', 0]
        : ['li', { class: 'task', 'data-checked': String(node.attrs.checked) }, ['span', { class: 'task-box', contenteditable: 'false' }], ['div', { class: 'task-body' }, 0]],
  },

  text: { group: 'inline' },

  image: {
    group: 'inline',
    inline: true,
    atom: true,
    draggable: true,
    // html: original `<img …>` tag when the image was written as HTML (keeps width etc.)
    attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null }, ref: { default: null }, html: { default: null } },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => ({
          src: (dom as HTMLElement).getAttribute('data-md-src') ?? (dom as HTMLElement).getAttribute('src'),
          alt: (dom as HTMLElement).getAttribute('alt') ?? '',
          title: (dom as HTMLElement).getAttribute('title'),
        }),
      },
    ],
    toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }],
  },

  hard_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    // html: original tag text (e.g. '<br />') when the break was written as HTML
    attrs: { spaces: { default: false }, html: { default: null } },
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  // A line break inside a paragraph in the source ("soft break"). Rendered as
  // a space like GitHub does, but written back as a newline.
  soft_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    parseDOM: [{ tag: 'span.soft-break' }],
    toDOM: () => ['span', { class: 'soft-break' }, ' '],
  },

  // Inline Markdown we don't edit structurally (inline HTML, footnote refs, …).
  raw_inline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { value: { default: '' } },
    parseDOM: [{ tag: 'span[data-raw-inline]', getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('data-raw-inline') }) }],
    toDOM: (node) => ['span', { 'data-raw-inline': node.attrs.value, class: 'raw-inline' }, node.attrs.value],
  },
}

// Order matters: on equal extent it is the nesting order when marks are turned
// back into mdast (`***x***` = em(strong), `**[x](u)**` = strong(link), code innermost).
const marks: Record<string, MarkSpec> = {
  em: {
    attrs: { marker: { default: '*' } },
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strong: {
    attrs: { marker: { default: '*' } },
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d\d)$/.test(v as string) && null }],
    toDOM: () => ['strong', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM: () => ['del', 0],
  },
  link: {
    attrs: { href: { default: '' }, title: { default: null }, ref: { default: null }, literal: { default: false }, nest: { default: null }, html: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title ?? mark.attrs.href }, 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
}

export const schema = new Schema({ nodes, marks })
