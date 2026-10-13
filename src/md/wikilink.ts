// Obsidian-style wiki links (extended syntax): [[Link]], [[Link|Text]], [[Link#Heading]],
// [[#Heading]] (this document), [[sub/Link]], [[../sub/Link]], with or without `.md`.
// In a table cell the `|` is written `\|` (else the table would split the cell).

export interface WikiParts {
  /** the file as written ('' for [[#Heading]]) */
  path: string
  heading: string | null
  alias: string | null
}

const MARKDOWN = /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i
/** a file extension (a.pdf, logo.png) – then no `.md` is added */
const EXTENSION = /\.[A-Za-z0-9]{1,5}$/

export function parseWiki(raw: string): WikiParts {
  const bar = /\\?\|/.exec(raw)
  const target = bar ? raw.slice(0, bar.index) : raw
  const alias = bar ? raw.slice(bar.index + bar[0].length).trim() || null : null
  const hash = target.indexOf('#')
  const path = (hash < 0 ? target : target.slice(0, hash)).trim()
  const heading = hash < 0 ? null : target.slice(hash + 1).trim() || null
  return { path, heading, alias }
}

/** What the editor shows: the alias, else "sub/Link › Heading" (without `.md`). */
export function wikiDisplay(raw: string): string {
  const { path, heading, alias } = parseWiki(raw)
  if (alias) return alias
  const name = path.replace(MARKDOWN, '')
  return heading ? (name ? `${name} › ${heading}` : heading) : name
}

/** The file a wiki link means: `Link` → `Link.md`, `a.pdf` stays. */
export function wikiFile(path: string): string {
  return !path || MARKDOWN.test(path) || EXTENSION.test(path) ? path : `${path}.md`
}

/** Only what would break a URL is encoded; umlauts stay readable. */
const encode = (s: string) => s.replace(/[% #?()<>"]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))

/** The link as a normal href (`sub/Link.md#heading`), for following it and for the HTML export. */
export function wikiHref(raw: string): string {
  const { path, heading } = parseWiki(raw)
  const fragment = heading ? `#${encodeURIComponent(heading)}` : ''
  return path ? encode(wikiFile(path)) + fragment : fragment || '#'
}

/** The inside of [[…]] from parts (`\|` in a table cell). */
export function wikiRaw(target: string, alias: string | null, inTable = false): string {
  const t = target.trim()
  const a = alias?.trim()
  return a && a !== t ? `${t}${inTable ? '\\|' : '|'}${a}` : t
}
