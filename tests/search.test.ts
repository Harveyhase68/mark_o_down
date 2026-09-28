import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'
import { EMPTY_QUERY, findMatches, matchText, findNext, replaceAll, replaceCurrent, searchPlugin, searchState, setQuery, type SearchQuery } from '../src/editor/search'

/** Minimal stand-in for an EditorView (the search commands only use state/dispatch). */
function fakeView(md: string) {
  const { doc, meta } = importMarkdown(md)
  let state = EditorState.create({ schema, doc, plugins: [searchPlugin] })
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      state = state.apply(tr)
    },
  } as unknown as EditorView
  return { view, markdown: () => exportMarkdown(view.state.doc, meta) }
}

const q = (text: string, opts: Partial<SearchQuery> = {}): SearchQuery => ({ ...EMPTY_QUERY, text, ...opts })
const texts = (md: string, query: SearchQuery) => {
  const { doc } = importMarkdown(md)
  return findMatches(doc, query).map((m) => matchText(doc, m))
}

describe('find', () => {
  const md = '# Größe und Größen\n\nDie **Größe** zählt, GRÖSSE auch. gross\n\n- Größe in Liste\n\n```\nGröße im Code\n```\n'

  it('ignores case by default and finds across formatting', () => {
    expect(texts(md, q('größe'))).toEqual(['Größe', 'Größe', 'Größe', 'Größe', 'Größe'])
  })

  it('case-sensitive and whole-word (Unicode aware)', () => {
    expect(texts(md, q('Größe', { caseSensitive: true, wholeWord: true }))).toHaveLength(4) // not "Größen"
    expect(texts(md, q('GRÖSSE', { caseSensitive: true }))).toEqual(['GRÖSSE'])
  })

  it('regular expressions', () => {
    expect(texts('a1 b22 c333\n', q('\\d{2,}', { regex: true }))).toEqual(['22', '333'])
    expect(() => findMatches(importMarkdown('x\n').doc, q('(', { regex: true }))).toThrow()
  })

  it('matches across a soft line break as a space', () => {
    expect(texts('hello\nworld\n', q('hello world'))).toEqual(['hello world'])
  })

  it('emojis and 4-byte characters', () => {
    expect(texts('Hallo 😂 Welt 😂\n', q('😂'))).toEqual(['😂', '😂'])
  })
})

describe('navigate & replace', () => {
  it('counts, moves and wraps around', () => {
    const { view } = fakeView('eins zwei eins drei eins\n')
    setQuery(view, q('eins'))
    expect(searchState(view.state).matches).toHaveLength(3)
    findNext(view, 1) // first match
    findNext(view, 1)
    findNext(view, 1)
    expect(searchState(view.state).current).toBe(2)
    findNext(view, 1)
    expect(searchState(view.state).current).toBe(0) // wrapped around
    findNext(view, -1)
    expect(searchState(view.state).current).toBe(2) // and backwards
  })

  it('replaces one match, keeps formatting, and moves on', () => {
    const { view, markdown } = fakeView('Das **Haus** und das Haus.\n')
    setQuery(view, q('haus'))
    findNext(view, 1)
    replaceCurrent(view, 'Heim')
    expect(markdown()).toBe('Das **Heim** und das Haus.\n')
    expect(searchState(view.state).matches).toHaveLength(1)
  })

  it('replace all in one step, with regex groups', () => {
    const { view, markdown } = fakeView('Version 1.2 und Version 3.4\n')
    setQuery(view, q('Version (\\d+)\\.(\\d+)', { regex: true }))
    expect(replaceAll(view, 'v$1-$2')).toBe(2)
    expect(markdown()).toBe('v1-2 und v3-4\n')
    expect(searchState(view.state).matches).toHaveLength(0)
  })

  it('replace with nothing deletes', () => {
    const { view, markdown } = fakeView('a-b-c\n')
    setQuery(view, q('-'))
    replaceAll(view, '')
    expect(markdown()).toBe('abc\n')
  })
})
