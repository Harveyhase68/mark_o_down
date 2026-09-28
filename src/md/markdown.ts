// Markdown text <-> mdast (the unified/remark syntax tree).
//
// Parsing: micromark (CommonMark + GFM + front matter), 100% spec compliant.
// Serializing: mdast-util-to-markdown, with per-node style hints stored in
// `node.data.mdo` so an edited block keeps its original "flavour"
// (`-` vs `*` bullets, `_em_` vs `*em*`, `~~~` vs ``` fences, setext headings …).

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import { toMarkdown, defaultHandlers, type Handle, type Options, type State } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { frontmatterToMarkdown } from 'mdast-util-frontmatter'
import { toString } from 'mdast-util-to-string'
import type { Nodes, Root, Link, Table } from 'mdast'

const FRONTMATTER = ['yaml', 'toml'] as const

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, [...FRONTMATTER])

export function parseMarkdown(text: string): Root {
  return processor.parse(text) as Root
}

/** Style hints attached to mdast nodes (`node.data.mdo`). */
export interface StyleHints {
  bullet?: '-' | '*' | '+'
  delim?: '.' | ')'
  increment?: boolean
  indent?: 'one' | 'tab' | 'mixed'
  marker?: '*' | '_'
  fence?: '`' | '~'
  indented?: boolean
  rule?: '*' | '-' | '_'
  repeat?: number
  spaces?: boolean
  setext?: boolean
  closeAtx?: boolean
  literal?: boolean
  pipeAlign?: boolean
  centerTag?: boolean
}

function hints(node: Nodes): StyleHints {
  return ((node.data as { mdo?: StyleHints } | undefined)?.mdo) ?? {}
}

function withOptions<T>(state: State, opts: Partial<Options>, fn: () => T): T {
  const saved = { ...state.options }
  Object.assign(state.options, opts)
  try {
    return fn()
  } finally {
    state.options = saved
  }
}

/**
 * Wrap a default handler so it runs with node-specific options. Handlers carry
 * helper functions as properties (`peek`, `attention`, …) that also read the
 * options; those are wrapped too (their `state` arg is found by shape).
 */
function styled(name: keyof typeof defaultHandlers, pick: (h: StyleHints) => Partial<Options>): Handle {
  const wrap = (fn: (...args: any[]) => any) =>
    function (this: unknown, ...args: any[]) {
      const state = args.find((a) => a && typeof a === 'object' && 'options' in a && 'handle' in a) as State | undefined
      return state ? withOptions(state, pick(hints(args[0])), () => fn.apply(this, args)) : fn.apply(this, args)
    }
  const orig = defaultHandlers[name] as Handle & Record<string, unknown>
  const h = wrap(orig) as Handle & Record<string, unknown>
  for (const key of Object.keys(orig)) h[key] = typeof orig[key] === 'function' ? wrap(orig[key] as never) : orig[key]
  return h
}

const drop = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

function literalText(node: Link): string | null {
  if (!hints(node).literal || node.title) return null
  if (node.children.length !== 1 || node.children[0].type !== 'text') return null
  const text = node.children[0].value
  return node.url === text || node.url === 'http://' + text || node.url === 'mailto:' + text ? text : null
}

type Peekable = Handle & { peek: Handle }
const defaultLink = defaultHandlers.link as unknown as Peekable

const link = ((node, parent, state, info) => literalText(node as Link) ?? defaultLink(node, parent, state, info)) as Peekable
link.peek = (node, parent, state, info) => {
  const lit = literalText(node as Link)
  return lit ? lit.charAt(0) : defaultLink.peek(node, parent, state, info)
}

// GFM tables: keep the original style per table (aligned pipes vs. compact `|---|`).
const tableAligned = gfmTableToMarkdown({ tablePipeAlign: true, stringLength: displayWidth }).handlers!
const tableCompact = gfmTableToMarkdown({ tablePipeAlign: false }).handlers!
const DELIM = { left: ':---', center: ':---:', right: '---:' } as const
const table: Handle = (node, parent, state, info) => {
  if (hints(node).pipeAlign !== false) return tableAligned.table!(node, parent, state, info)
  // compact style: `|---|:---:|` instead of the library's `| - | :-: |`
  const lines = tableCompact.table!(node, parent, state, info).split('\n')
  const align = (node as Table).align ?? []
  const cols = (node as Table).children[0]?.children.length ?? align.length
  lines[1] = '|' + Array.from({ length: cols }, (_, i) => DELIM[align[i] as keyof typeof DELIM] ?? '---').join('|') + '|'
  return lines.join('\n')
}

const WIDE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u
const graphemes = new Intl.Segmenter()

/** Monospace display width per grapheme: emoji (incl. ZWJ sequences, flags) and CJK count 2. */
function displayWidth(text: string): number {
  let w = 0
  for (const { segment } of graphemes.segment(text)) w += WIDE.test(segment) ? 2 : 1
  return w
}

const handlers: Options['handlers'] = {
  list: styled('list', (h) => drop({ bullet: h.bullet, bulletOrdered: h.delim, incrementListMarker: h.increment, listItemIndent: h.indent })),
  emphasis: styled('emphasis', (h) => drop({ emphasis: h.marker })),
  strong: styled('strong', (h) => drop({ strong: h.marker })),
  code: styled('code', (h) => drop({ fence: h.fence, fences: h.indented === undefined ? undefined : !h.indented })),
  thematicBreak: styled('thematicBreak', (h) => drop({ rule: h.rule, ruleRepetition: h.repeat, ruleSpaces: h.spaces })),
  heading: styled('heading', (h) => drop({ setext: h.setext, closeAtx: h.closeAtx })),
  break: (node, parent, state, info) => {
    const out = defaultHandlers.break(node as never, parent, state, info)
    return out === '\\\n' && hints(node as Nodes).spaces ? '  \n' : out
  },
  link,
  table,
  root: (node, parent, state, info) => {
    // The library escapes every `&` before a letter (`?a=1\&b=2` in URLs). CommonMark
    // only decodes complete references (`&copy;`, `&#35;`), so escape just those.
    state.unsafe = state.unsafe.map((p) => (p.character === '&' && p.after === '[#A-Za-z]' ? AMP_UNSAFE : p))
    return defaultHandlers.root(node as Root, parent, state, info)
  },
}

const AMP_UNSAFE = { character: '&', after: '(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});', inConstruct: 'phrasing' } as const

const baseOptions: Options = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  listItemIndent: 'one',
  handlers,
  // `<div align="center">`/`</div>` must be separated by blank lines, or the
  // Markdown inside would be swallowed by the HTML block.
  join: [(left, right) => (hints(left).centerTag || hints(right).centerTag ? 1 : undefined)],
  extensions: [gfmToMarkdown(), frontmatterToMarkdown([...FRONTMATTER])],
}

/** Serialize mdast; returns Markdown without the trailing newline. */
export function stringifyMarkdown(tree: Root | Nodes, overrides?: Partial<Options>): string {
  const root: Root = tree.type === 'root' ? tree : { type: 'root', children: [tree as Root['children'][number]] }
  const out = toMarkdown(root, overrides ? { ...baseOptions, ...overrides } : baseOptions)
  return out.replace(/\n$/, '')
}

export { toString as mdastToString }
