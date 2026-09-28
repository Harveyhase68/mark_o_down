// Find & replace: a ProseMirror plugin that keeps the matches of the current
// query and highlights them. Matches never cross block boundaries.

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

export interface SearchQuery {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface Match {
  from: number
  to: number
}

interface SearchState {
  query: SearchQuery
  matches: Match[]
  current: number
  /** Invalid regular expression. */
  error: string | null
}

export const EMPTY_QUERY: SearchQuery = { text: '', caseSensitive: false, wholeWord: false, regex: false }

const key = new PluginKey<SearchState>('search')

// ------------------------------------------------------------------ matching (pure)

/** The query as a global RegExp; throws on an invalid regular expression. */
export function toRegExp(q: SearchQuery): RegExp | null {
  if (!q.text) return null
  let source = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Unicode-aware word boundaries (\b only knows ASCII: "Größe" has none inside)
  if (q.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  return new RegExp(source, q.caseSensitive ? 'gu' : 'giu')
}

/**
 * Text of a textblock with one character per document position:
 * text as is, a line break for hard breaks, a space for soft breaks and an
 * object-replacement character for images and other inline atoms.
 */
const leafText = (leaf: PMNode) => (leaf.type.name === 'hard_break' ? '\n' : leaf.type.name === 'soft_break' ? ' ' : '￼')

function blockText(block: PMNode): string {
  let s = ''
  block.forEach((child) => (s += child.isText ? child.text : leafText(child)))
  return s
}

/** The text of a match, with the same character mapping the search uses. */
export function matchText(doc: PMNode, m: Match): string {
  return doc.textBetween(m.from, m.to, '\n', leafText)
}

export function findMatches(doc: PMNode, q: SearchQuery): Match[] {
  const re = toRegExp(q)
  if (!re) return []
  const out: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = blockText(node)
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0] === '') {
        re.lastIndex++ // e.g. /x*/ – skip empty matches
        continue
      }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length })
    }
    return false
  })
  return out
}

/** Replacement text for one match (regex mode supports $1, $&, …). */
export function replacementFor(matched: string, q: SearchQuery, replacement: string): string {
  if (!q.regex) return replacement
  const re = toRegExp(q)!
  return matched.replace(new RegExp(re.source, re.flags.replace('g', '')), replacement)
}

// ------------------------------------------------------------------ plugin

function compute(doc: PMNode, query: SearchQuery, near: number): SearchState {
  try {
    const matches = findMatches(doc, query)
    // keep the "current" match close to where it was (or the cursor)
    let current = matches.findIndex((m) => m.to > near)
    if (current < 0) current = matches.length ? 0 : -1
    return { query, matches, current, error: null }
  } catch (e) {
    return { query, matches: [], current: -1, error: (e as Error).message }
  }
}

type Meta = { query: SearchQuery } | { current: number }

export const searchPlugin = new Plugin<SearchState>({
  key,
  state: {
    init: () => ({ query: EMPTY_QUERY, matches: [], current: -1, error: null }),
    apply(tr, prev, _old, state) {
      const meta = tr.getMeta(key) as Meta | undefined
      if (meta && 'query' in meta) return compute(state.doc, meta.query, state.selection.from)
      if (meta && 'current' in meta) return { ...prev, current: meta.current }
      if (tr.docChanged && prev.query.text) {
        const near = prev.matches[prev.current] ? tr.mapping.map(prev.matches[prev.current].from) : state.selection.from
        return compute(state.doc, prev.query, near - 1)
      }
      return prev
    },
  },
  props: {
    decorations(state) {
      const s = key.getState(state)
      if (!s?.matches.length) return null
      return DecorationSet.create(
        state.doc,
        s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'search-match search-current' : 'search-match' })),
      )
    },
  },
})

export function searchState(state: EditorState): SearchState {
  return key.getState(state)!
}

export function setQuery(view: EditorView, query: SearchQuery) {
  view.dispatch(view.state.tr.setMeta(key, { query }))
}

function reveal(tr: Transaction, m: Match): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
}

/** Select and scroll to the current match (while typing the search text). */
export function revealCurrent(view: EditorView) {
  const s = searchState(view.state)
  const m = s.matches[s.current]
  if (m) view.dispatch(reveal(view.state.tr, m))
}

/** Go to the next (dir 1) or previous (dir -1) match; wraps around. */
export function findNext(view: EditorView, dir: 1 | -1) {
  const s = searchState(view.state)
  if (!s.matches.length) return
  const n = s.matches.length
  // from the cursor if it's not on the current match (the user clicked elsewhere)
  const sel = view.state.selection
  const cur = s.matches[s.current]
  let next: number
  if (cur && sel.from === cur.from && sel.to === cur.to) next = (s.current + dir + n) % n
  else if (dir === 1) next = Math.max(0, s.matches.findIndex((m) => m.from >= sel.to))
  else {
    const i = s.matches.findLastIndex((m) => m.to <= sel.from)
    next = i < 0 ? n - 1 : i
  }
  view.dispatch(reveal(view.state.tr.setMeta(key, { current: next }), s.matches[next]))
}

/** Replace the current match and move on to the next one. */
export function replaceCurrent(view: EditorView, replacement: string) {
  const s = searchState(view.state)
  const m = s.matches[s.current]
  if (!m) return
  const text = replacementFor(matchText(view.state.doc, m), s.query, replacement)
  const tr = text ? view.state.tr.insertText(text, m.from, m.to) : view.state.tr.delete(m.from, m.to)
  view.dispatch(tr)
  // the plugin recomputed the matches; continue after the replaced text
  const after = searchState(view.state)
  const end = m.from + text.length
  const next = after.matches.findIndex((x) => x.from >= end)
  if (next >= 0) view.dispatch(reveal(view.state.tr.setMeta(key, { current: next }), after.matches[next]))
}

/** Replace every match in one step (one undo). Returns the number of replacements. */
export function replaceAll(view: EditorView, replacement: string): number {
  const s = searchState(view.state)
  if (!s.matches.length) return 0
  const tr = view.state.tr
  // from the end, so earlier positions stay valid
  for (const m of [...s.matches].reverse()) {
    const text = replacementFor(matchText(tr.doc, m), s.query, replacement)
    if (text) tr.insertText(text, m.from, m.to)
    else tr.delete(m.from, m.to)
  }
  view.dispatch(tr.scrollIntoView())
  return s.matches.length
}
