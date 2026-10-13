import { afterEach, describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { setExtendedSyntax } from '../src/md/markdown'
import { renderHtml } from '../src/md/html'
import { parseWiki, wikiDisplay, wikiHref, wikiRaw } from '../src/md/wikilink'

const links = (doc: PMNode) => {
  const out: string[] = []
  doc.descendants((n) => void (n.type.name === 'wikilink' && out.push(n.attrs.raw)))
  return out
}
const untouched = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta)
}
const reserialize = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta, { preserve: false })
}

afterEach(() => setExtendedSyntax(true))

describe('wiki links: parts', () => {
  it('target, heading, alias', () => {
    expect(parseWiki('Link')).toEqual({ path: 'Link', heading: null, alias: null })
    expect(parseWiki('sub/Link#Linux unter Ubuntu|Hier')).toEqual({ path: 'sub/Link', heading: 'Linux unter Ubuntu', alias: 'Hier' })
    expect(parseWiki('#Installation')).toEqual({ path: '', heading: 'Installation', alias: null })
    expect(parseWiki('../a/B.md\\|Text')).toEqual({ path: '../a/B.md', heading: null, alias: 'Text' }) // in a table
  })

  it('display and href', () => {
    expect(wikiDisplay('Link')).toBe('Link')
    expect(wikiDisplay('Link.md|Zur Datei')).toBe('Zur Datei')
    expect(wikiDisplay('sub/Link#Linux')).toBe('sub/Link › Linux')
    expect(wikiDisplay('#Installation')).toBe('Installation')
    expect(wikiHref('Link')).toBe('Link.md')
    expect(wikiHref('sub/Mein Link#Linux unter Ubuntu')).toBe('sub/Mein%20Link.md#Linux%20unter%20Ubuntu')
    expect(wikiHref('#Installation')).toBe('#Installation')
    expect(wikiHref('Bild.png')).toBe('Bild.png')
    expect(wikiHref('Notiz.markdown')).toBe('Notiz.markdown')
  })

  it('raw from parts', () => {
    expect(wikiRaw('Link', 'Text')).toBe('Link|Text')
    expect(wikiRaw('Link', 'Link')).toBe('Link')
    expect(wikiRaw('Link', 'Text', true)).toBe('Link\\|Text')
  })
})

describe('wiki links in documents', () => {
  const md = 'Siehe [[Link]], [[Link|Link zur Datei]], [[Link#linux]], [[#Abschnitt]], [[sub/Link]] und [[../sub/Link]].\n\n| A | B |\n|---|---|\n| [[Tabelle\\|Text]] | x |\n'

  it('become wiki link nodes and stay exactly as written', () => {
    const { doc } = importMarkdown(md)
    expect(links(doc)).toEqual(['Link', 'Link|Link zur Datei', 'Link#linux', '#Abschnitt', 'sub/Link', '../sub/Link', 'Tabelle\\|Text'])
    expect(untouched(md)).toBe(md)
    expect(reserialize(md)).toBe(md)
  })

  it('not wiki links: empty, across lines, nested brackets, normal links', () => {
    const { doc } = importMarkdown('[[]] [[a\nb]] [[a[b]]] [Text](Link.md) [x][y]\n\n[y]: https://x.dev\n')
    expect(links(doc)).toEqual([])
  })

  it('HTML export: a real link', () => {
    expect(renderHtml('[[sub/Link#Linux|Hier]] und [[#Teil]]')).toBe('<p><a href="sub/Link.md#Linux" class="wikilink">Hier</a> und <a href="#Teil" class="wikilink">Teil</a></p>')
  })

  it('with the extended syntax off: text, like on GitHub', () => {
    setExtendedSyntax(false)
    const { doc } = importMarkdown('[[Link]]\n')
    expect(links(doc)).toEqual([])
    expect(untouched('[[Link]]\n')).toBe('[[Link]]\n')
  })
})
