// HTML → Markdown import.
//
// Markdown can express much less than HTML. Kept: headings, paragraphs, bold/
// italic/strikethrough, links, images, lists, tables, code, quotes, rules – and,
// as HTML, `<div align="center">`, `<br>` and `<img>` with size/alignment.
// Everything else is analysed first, so the user can be told what will be lost.

import { fromHtml } from 'hast-util-from-html'
import { defaultHandlers, toMdast, type Handle } from 'hast-util-to-mdast'
import { toHtml } from 'hast-util-to-html'
import type { Element, Nodes as HNodes, Root as HRoot } from 'hast'
import type { Nodes as MNodes, RootContent } from 'mdast'
import { stringifyMarkdown } from './markdown'
import { find, html as htmlSchema } from 'property-information'

export interface HtmlLoss {
  /** What is lost, e.g. "<span> – Formatierung" */
  label: string
  count: number
}

export interface HtmlImport {
  markdown: string
  title: string | null
  losses: HtmlLoss[]
}

// ------------------------------------------------------------------ loss analysis

/** Converted to Markdown without loss (with the attributes listed). */
const KEPT: Record<string, string[]> = {
  p: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  strong: [], b: [], em: [], i: [], del: [], s: [], strike: [], code: [], kbd: [], samp: [], tt: [], var: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'align'],
  br: [], hr: [], ul: [], ol: ['start'], li: [], blockquote: [], pre: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['align'], td: ['align'],
  div: ['align'], center: [],
  html: ['lang'], head: [], body: [], title: [], meta: ['charset', 'name', 'content', 'http-equiv'],
}

/** Removed together with their content. */
const REMOVED: Record<string, string> = {
  script: 'Skripte (<script>)',
  style: 'Stylesheets (<style>)',
  link: 'Verknüpfte Stylesheets/Ressourcen (<link>)',
  svg: 'Vektorgrafiken (<svg>)',
  canvas: 'Zeichenflächen (<canvas>)',
  template: 'Vorlagen (<template>)',
  embed: 'Eingebettete Objekte (<embed>/<object>)',
  object: 'Eingebettete Objekte (<embed>/<object>)',
  math: 'Formeln (<math>)',
  caption: 'Tabellenbeschriftungen (<caption>)',
}

/** Replaced by something simpler. */
const REPLACED: Record<string, string> = {
  iframe: 'Eingebettete Seiten (<iframe>) → nur Link',
  video: 'Videos (<video>) → nur Link',
  audio: 'Audio (<audio>) → nur Link',
  u: 'Unterstreichung (<u>) → kursiv',
  mark: 'Markierung (<mark>) → kursiv',
  input: 'Formularfelder → Text (Checkboxen in Listen bleiben)',
  select: 'Formularfelder → Text (Checkboxen in Listen bleiben)',
  textarea: 'Formularfelder → Text (Checkboxen in Listen bleiben)',
  button: 'Schaltflächen (<button>) → Text',
  dl: 'Definitionslisten (<dl>) → normale Liste',
  q: 'Zitate im Text (<q>) → Anführungszeichen',
  sup: 'Hoch-/Tiefstellung (<sup>/<sub>) → normaler Text',
  sub: 'Hoch-/Tiefstellung (<sup>/<sub>) → normaler Text',
  details: 'Aufklappbereiche (<details>) → normaler Text',
  summary: 'Aufklappbereiche (<details>) → normaler Text',
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  style: 'Inline-Styles (style="…")',
  class: 'CSS-Klassen (class="…")',
  id: 'Sprungmarken/IDs (id="…")',
  target: 'Link-Ziele (target="_blank" …) – Links öffnen normal',
}

/** hast property name → HTML attribute name (className → class, charSet → charset …). */
const attrName = (prop: string) => find(htmlSchema, prop).attribute

export function analyseHtml(tree: HRoot): HtmlLoss[] {
  const counts = new Map<string, number>()
  const add = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1)

  const visit = (node: HNodes, inListItem: boolean) => {
    if (node.type === 'element') {
      const tag = node.tagName
      // the frame of our own HTML export: not content
      if (tag === 'article' && String(node.properties.className) === 'markdown-body') {
        for (const c of node.children) visit(c, inListItem)
        return
      }
      if (REMOVED[tag]) return void add(REMOVED[tag]) // content is gone too
      if (tag === 'input' && inListItem && node.properties.type === 'checkbox') {
        // task list checkbox: kept
      } else if (REPLACED[tag]) add(REPLACED[tag])
      else if (tag === 'div' && node.properties.align !== 'center') add('Layout-Container (<div>) – nur der Inhalt bleibt')
      else if (!KEPT[tag]) add(`<${tag}> – Formatierung geht verloren, Text bleibt`)

      // embedded media become a link: their attributes are used, not lost
      if (tag === 'iframe' || tag === 'video' || tag === 'audio') return
      const allowed = KEPT[tag] ?? []
      for (const [prop, value] of Object.entries(node.properties)) {
        if (value === undefined || value === null || value === false) continue
        const name = attrName(prop)
        if (allowed.includes(name) || (tag === 'input' && ['type', 'checked', 'disabled'].includes(name))) continue
        add(ATTRIBUTE_LABELS[name] ?? `Attribute (${name}=…)`)
      }
      for (const c of node.children) visit(c, inListItem || tag === 'li')
    } else if (node.type === 'root') {
      for (const c of node.children) visit(c, inListItem)
    } else if (node.type === 'comment') {
      add('Kommentare (<!-- … -->)')
    }
  }
  visit(tree, false)
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

// ------------------------------------------------------------------ conversion

const centerTag = (value: string) => ({ type: 'html', value, data: { mdo: { centerTag: true } } }) as RootContent

/** `<div align="center">` and `<center>`: kept as our centered block. */
const center: Handle = (state, node) => {
  const el = node as Element
  const children = state.toFlow(state.all(el))
  if (el.tagName === 'div' && el.properties.align !== 'center') return children
  return [centerTag('<div align="center">'), ...children, centerTag('</div>')] as MNodes[]
}

const IMG_ATTRS = ['src', 'alt', 'title', 'width', 'height', 'align']

/** `<img>` with size or alignment stays an HTML tag (Markdown images have no size). */
const img: Handle = (state, node) => {
  const el = node as Element
  const p = el.properties
  if (p.width === undefined && p.height === undefined && p.align === undefined) return defaultHandlers.img(state, el)
  const clean: Element = {
    type: 'element',
    tagName: 'img',
    properties: Object.fromEntries(Object.entries(p).filter(([k]) => IMG_ATTRS.includes(attrName(k)))),
    children: [],
  }
  return { type: 'html', value: toHtml(clean) }
}

const PHRASING_PARENTS = new Set(['p', 'span', 'a', 'b', 'strong', 'i', 'em', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'small', 'font'])

/** `<iframe>`: always a link to the embedded page (the library drops it without a title). */
const iframe: Handle = (_state, node, parent) => {
  const p = (node as Element).properties
  const src = String(p.src ?? '')
  if (!src) return undefined
  const link = { type: 'link', url: src, title: null, children: [{ type: 'text', value: String(p.title ?? '') || src }] } as MNodes
  // an iframe is a block of its own – unless it sits inside running text
  const inline = parent?.type === 'element' && PHRASING_PARENTS.has(parent.tagName)
  return inline ? link : ({ type: 'paragraph', children: [link] } as MNodes)
}

function documentTitle(tree: HRoot): string | null {
  let title: string | null = null
  const visit = (n: HNodes) => {
    if (title !== null) return
    if (n.type === 'element' && n.tagName === 'title') {
      title = n.children.map((c) => (c.type === 'text' ? c.value : '')).join('').trim() || null
    } else if ('children' in n) n.children.forEach((c) => visit(c as HNodes))
  }
  visit(tree)
  return title
}

export function htmlToMarkdown(html: string): HtmlImport {
  const tree = fromHtml(html)
  const losses = analyseHtml(tree)
  const mdast = toMdast(tree, { handlers: { div: center, center, img, iframe } })
  const markdown = stringifyMarkdown(mdast as MNodes)
  return { markdown: markdown ? markdown + '\n' : '', title: documentTitle(tree), losses }
}
