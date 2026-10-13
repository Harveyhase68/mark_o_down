// [[toc]] / [[toc depth=3]] on a line of its own: a table of contents, generated – only the
// marker is saved. In a workspace it lists all its documents (folder by folder, like the
// tree) with their headings; otherwise the headings of the document itself. `depth` is the
// deepest heading level shown (default 3). Part of the extended / wiki link syntax.

import { slugify } from './anchors'
import { extendedSyntaxOn, wikiLinksOn } from './markdown'

export const DEFAULT_TOC_DEPTH = 3

/** Is [[toc]] recognized? (With the extended syntax or wiki links – GitHub shows it as text.) */
export const tocOn = () => extendedSyntaxOn() || wikiLinksOn()

/** `[[toc]]`, `[[TOC]]`, `[[toc depth=2]]` → its depth; anything else null. */
export function parseTocMarker(text: string): { depth: number } | null {
  const m = /^\[\[\s*toc(?:\s+depth\s*=\s*(\d+))?\s*\]\]$/i.exec(text.trim())
  if (!m) return null
  return { depth: m[1] ? Math.min(Math.max(+m[1], 1), 6) : DEFAULT_TOC_DEPTH }
}

export interface TocItem {
  text: string
  /** where it leads ('' for a folder) */
  href: string
  children: TocItem[]
  folder?: boolean
}

export interface Heading {
  level: number
  text: string
  /** GitHub's anchor (repeated headings: -1, -2 …) */
  slug: string
}

/** Inline Markdown → its text (links → their text, emphasis marks and tags removed). */
export function plainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*?)(?:\\?\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|==|[*_`^~])/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~^=])/g, '$1')
    .trim()
}

/** The headings of a Markdown text up to `maxLevel` (code blocks and front matter skipped). */
export function headingsOf(markdown: string, maxLevel = 6): Heading[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: Heading[] = []
  const seen = new Map<string, number>()
  const add = (level: number, raw: string) => {
    const text = plainText(raw)
    const base = slugify(text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    if (level <= maxLevel && text) out.push({ level, text, slug: n ? `${base}-${n}` : base })
  }
  let fence: string | null = null
  let i = 0
  if (/^(---|\+\+\+)\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === lines[0].trim())
    if (end > 0) i = end + 1
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line)
    if (atx) {
      add(atx[1].length, atx[2] ?? '')
      continue
    }
    // setext: a text line followed by === or ---
    const next = lines[i + 1]
    if (next !== undefined && line.trim() && !/^ {0,3}([-*+>]|\d+[.)])\s/.test(line) && /^ {0,3}(=+|-+)[ \t]*$/.test(next)) {
      add(next.trim()[0] === '=' ? 1 : 2, line.trim())
      i++
    }
  }
  return out
}

/** Headings → a nested list (a deeper heading goes below the one before it). */
export function nestHeadings(headings: Heading[], href: (slug: string) => string): TocItem[] {
  const root: TocItem[] = []
  const stack: { level: number; children: TocItem[] }[] = [{ level: 0, children: root }]
  for (const h of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop()
    const item: TocItem = { text: h.text, href: href(h.slug), children: [] }
    stack[stack.length - 1].children.push(item)
    stack.push({ level: h.level, children: item.children })
  }
  return root
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const FRONT = /^(readme|index)\.md$/i

export interface TocDocument {
  /** relative to the workspace folder, with `/` */
  path: string
  markdown: string
}

/**
 * The table of contents of a workspace: folder by folder like the tree (in each folder its
 * README/index first, then the documents, then the subfolders – natural order). A document
 * shows its first level-1 heading as title (else its file name) and its headings below it
 * up to `depth`. `href(path, slug)`: the link to a document (slug null: the document itself).
 */
export function workspaceToc(docs: TocDocument[], depth: number, href: (path: string, slug: string | null) => string): TocItem[] {
  interface Folder {
    files: TocDocument[]
    folders: Map<string, Folder>
  }
  const top: Folder = { files: [], folders: new Map() }
  for (const d of docs) {
    const parts = d.path.split('/')
    let f = top
    for (const p of parts.slice(0, -1)) {
      if (!f.folders.has(p)) f.folders.set(p, { files: [], folders: new Map() })
      f = f.folders.get(p)!
    }
    f.files.push(d)
  }
  const docItem = (d: TocDocument): TocItem => {
    const headings = headingsOf(d.markdown, depth)
    const first = headings[0]
    const titled = first?.level === 1
    const name = d.path.slice(d.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    const rest = titled ? headings.slice(1) : headings
    return { text: titled ? first.text : name, href: href(d.path, null), children: depth > 1 ? nestHeadings(rest.filter((h) => h.level > 1), (s) => href(d.path, s)) : [] }
  }
  const build = (f: Folder): TocItem[] => {
    const files = [...f.files].sort((a, b) => {
      const an = a.path.slice(a.path.lastIndexOf('/') + 1)
      const bn = b.path.slice(b.path.lastIndexOf('/') + 1)
      return Number(FRONT.test(bn)) - Number(FRONT.test(an)) || collator.compare(an, bn)
    })
    const folders = [...f.folders].sort(([a], [b]) => collator.compare(a, b))
    return [
      ...files.map(docItem),
      ...folders.map(([name, sub]) => ({ text: name, href: '', folder: true, children: build(sub) })).filter((x) => x.children.length),
    ]
  }
  return build(top)
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The table of contents as HTML (for the export and the editor). */
export function tocHtml(items: TocItem[], title: string): string {
  const list = (xs: TocItem[]): string =>
    xs.length
      ? `<ul>${xs.map((x) => `<li${x.folder ? ' class="toc-folder"' : ''}>${x.href ? `<a href="${escapeHtml(x.href)}">${escapeHtml(x.text)}</a>` : `<span>${escapeHtml(x.text)}</span>`}${list(x.children)}</li>`).join('')}</ul>`
      : ''
  return `<nav class="toc" aria-label="${escapeHtml(title)}">${list(items)}</nav>`
}
