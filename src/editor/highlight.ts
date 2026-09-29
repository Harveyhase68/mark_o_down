// Syntax highlighting of fenced code blocks (```js …), like GitHub.
//
// highlight.js is loaded only when a document has a code block with a language
// (separate chunk). The editor shows the colours as decorations – the text in
// the document stays plain, nothing of it ends up in the Markdown.

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import type { HLJSApi } from 'highlight.js'

let hljs: HLJSApi | null = null
let loading: Promise<HLJSApi> | null = null

/** Load highlight.js (the ~35 common languages + PowerShell and Dockerfile). */
export function loadHighlighter(): Promise<HLJSApi> {
  loading ??= Promise.all([
    import('highlight.js/lib/common'),
    import('highlight.js/lib/languages/powershell'),
    import('highlight.js/lib/languages/dockerfile'),
  ]).then(([common, ps, docker]) => {
    const h = common.default
    h.registerLanguage('powershell', ps.default)
    h.registerLanguage('dockerfile', docker.default)
    return (hljs = h)
  })
  return loading
}

/** A coloured stretch of a code block: offsets in its text, highlight.js classes. */
export interface Token {
  from: number
  to: number
  cls: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }

/** highlight.js HTML (`<span class="hljs-string">"a"</span>`) → coloured ranges of the plain text. */
export function tokensFromHtml(html: string): Token[] {
  const out: Token[] = []
  const stack: string[] = []
  let pos = 0
  const re = /<span class="([^"]*)">|<\/span>|&(#?\w+);|[^<&]+/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] !== undefined) stack.push(m[1])
    else if (m[0] === '</span>') stack.pop()
    else {
      const len = m[2] !== undefined ? (ENTITIES[m[2]] ?? m[0]).length : m[0].length
      if (stack.length) {
        const cls = stack.join(' ')
        const last = out[out.length - 1]
        if (last && last.to === pos && last.cls === cls) last.to += len
        else out.push({ from: pos, to: pos + len, cls })
      }
      pos += len
    }
  }
  return out
}

/** highlight.js name for a fence's info string (`js`, `TS`, `shell` …); null if unknown. */
export function language(h: HLJSApi, lang: string | null): string | null {
  const name = lang?.trim().split(/\s/)[0].toLowerCase()
  return name && h.getLanguage(name) ? name : null
}

// Unchanged code blocks are not highlighted again: results by language + text.
const cache = new Map<string, Token[]>()
const MAX_CACHE = 200
const MAX_LENGTH = 100_000 // longer blocks stay plain (highlighting would be slow)

export function highlightCode(h: HLJSApi, lang: string, text: string): Token[] {
  const key = `${lang}\u0000${text}`
  let tokens = cache.get(key)
  if (!tokens) {
    tokens = text.length > MAX_LENGTH ? [] : tokensFromHtml(h.highlight(text, { language: lang, ignoreIllegals: true }).value)
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
    cache.set(key, tokens)
  }
  return tokens
}

const hasLangBlock = (doc: PMNode) => {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (n.type.name === 'code_block' && n.attrs.lang) found = true
    return !n.isTextblock
  })
  return found
}

function decorations(doc: PMNode): DecorationSet {
  const h = hljs
  if (!h) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((n, pos) => {
    if (n.type.name !== 'code_block') return !n.isTextblock
    const lang = language(h, n.attrs.lang)
    if (lang) for (const t of highlightCode(h, lang, n.textContent)) decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.cls }))
    return false
  })
  return DecorationSet.create(doc, decos)
}

const key = new PluginKey<DecorationSet>('highlight')

export const highlightPlugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: (_, state) => decorations(state.doc),
    apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorations(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return key.getState(state)
    },
  },
  // load highlight.js the first time a code block with a language shows up
  view(view) {
    const check = () => {
      if (hljs || !hasLangBlock(view.state.doc)) return
      void loadHighlighter().then(() => {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
      })
    }
    check()
    return { update: check }
  },
})
