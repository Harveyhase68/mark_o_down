// The few HTML tags we edit visually inside Markdown: `<img>`, `<br>` and an
// `<a href>` wrapped around them (typical for logos/badges in READMEs).
// The original tag text is kept; on export only changed attributes are touched.

export const BR = /^<br\s*\/?>$/i
export const IMG = /^<img\b[^>]*>$/i
export const A_OPEN = /^<a\b[^>]*>$/i
export const A_CLOSE = /^<\/a\s*>$/i

const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** Attributes of a start tag (names lower-cased, entities `&amp;`/`&quot;` decoded). */
export function tagAttrs(tag: string): Record<string, string> {
  const inner = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '')
  const out: Record<string, string> = {}
  for (const m of inner.matchAll(ATTR)) {
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

const decode = (v: string) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const encode = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Set (or remove, with null) one attribute, keeping the rest of the tag untouched. */
export function setTagAttr(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`(\\s)${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?`, 'i')
  if (re.test(tag)) return value === null ? tag.replace(re, '') : tag.replace(re, `$1${name}="${encode(value)}"`)
  if (value === null) return tag
  return tag.replace(/\s*(\/?)>$/, (_m, slash: string) => ` ${name}="${encode(value)}"${slash ? ' /' : ''}>`)
}

export type HtmlToken =
  | { kind: 'img'; tag: string }
  | { kind: 'br'; tag: string }
  | { kind: 'a'; tag: string }
  | { kind: '/a'; tag: string }
  | { kind: 'space'; text: string }

/** Split an HTML block into img/br/a tokens; null if it contains anything else. */
export function tokenizeImageHtml(html: string): HtmlToken[] | null {
  const tokens: HtmlToken[] = []
  const re = /<img\b[^>]*>|<br\s*\/?>|<a\b[^>]*>|<\/a\s*>|\s+/gi
  let pos = 0
  for (const m of html.matchAll(re)) {
    if (m.index !== pos) return null
    const t = m[0]
    pos += t.length
    if (/^\s/.test(t)) tokens.push({ kind: 'space', text: t })
    else if (IMG.test(t)) tokens.push({ kind: 'img', tag: t })
    else if (BR.test(t)) tokens.push({ kind: 'br', tag: t })
    else if (A_OPEN.test(t)) tokens.push({ kind: 'a', tag: t })
    else tokens.push({ kind: '/a', tag: t })
  }
  if (pos !== html.length || !tokens.some((t) => t.kind === 'img')) return null
  // anchors must be balanced and not nested
  let open = false
  for (const t of tokens) {
    if (t.kind === 'a') {
      if (open) return null
      open = true
    } else if (t.kind === '/a') {
      if (!open) return null
      open = false
    }
  }
  return open ? null : tokens
}
