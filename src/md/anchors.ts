// Link targets: anchors of headings (GitHub's rule) and what a link points to.
//
// GitHub gives every heading an id: lowercase, punctuation removed, spaces → "-",
// letters of any script (umlauts) kept; a repeated heading gets "-1", "-2" … –
// `[Installation](#installation)` jumps there. HTML anchors (`<a name="x">`,
// `id="x"`) count too.

import type { Node as PMNode } from 'prosemirror-model'

/** GitHub's heading id (github-slugger). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

export interface Anchor {
  id: string
  /** position of the heading / anchor element in the document */
  pos: number
  /** the heading's text (Obsidian's [[#Heading]] uses it) */
  text: string
}

const NAME_OR_ID = /\b(?:name|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

/** All anchors of a document, in document order. */
export function anchors(doc: PMNode): Anchor[] {
  const out: Anchor[] = []
  const seen = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent
      const base = slugify(text)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({ id: n ? `${base}-${n}` : base, pos, text })
      return true // HTML anchors inside the heading too
    }
    // <a name="x"> / <span id="x"> as inline HTML or as an HTML link
    const html = node.type.name === 'raw_inline' ? node.attrs.value : node.isText ? node.marks.find((m) => m.attrs.html)?.attrs.html : null
    if (typeof html === 'string' && /^<[a-z]/i.test(html)) {
      for (const m of html.matchAll(NAME_OR_ID)) out.push({ id: m[1] ?? m[2] ?? m[3], pos, text: '' })
    }
    return true
  })
  return out
}

/** The anchor a `#fragment` means: id as written, decoded, case-insensitive; else a heading text. */
export function findAnchor(doc: PMNode, fragment: string): Anchor | null {
  let wanted = fragment
  try {
    wanted = decodeURIComponent(fragment)
  } catch {
    // a literal %
  }
  const list = anchors(doc)
  return (
    list.find((a) => a.id === wanted) ??
    list.find((a) => a.id.toLowerCase() === wanted.toLowerCase()) ??
    list.find((a) => a.text && slugify(a.text) === slugify(wanted)) ?? // "#Linux unter Ubuntu" (Obsidian style)
    null
  )
}

export type LinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; fragment: string | null }

/** What a link's href points to. `path` is still relative and URL-decoded. */
export function parseLinkTarget(href: string): LinkTarget | null {
  const h = href.trim()
  if (!h) return null
  if (h.startsWith('#')) return { kind: 'anchor', fragment: h.slice(1) }
  // a scheme (https:, mailto: …) – but not a Windows drive (C:\…, C:/…)
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[a-z]:[\\/]/i.test(h)) return { kind: 'external', url: h }
  const hash = h.indexOf('#')
  const pathPart = (hash < 0 ? h : h.slice(0, hash)).replace(/\?.*$/, '')
  let path = pathPart
  try {
    path = decodeURIComponent(pathPart)
  } catch {
    // keep as written
  }
  return { kind: 'file', path, fragment: hash < 0 ? null : h.slice(hash + 1) || null }
}
