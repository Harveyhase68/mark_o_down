import { afterEach, describe, expect, it } from 'vitest'
import { headingsOf, nestHeadings, parseTocMarker, plainText, workspaceOrder, workspaceToc, type TocItem } from '../src/md/toc'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { setExtendedSyntax, setWikiLinks } from '../src/md/markdown'
import { renderHtml } from '../src/md/html'

afterEach(() => {
  setWikiLinks(null)
  setExtendedSyntax(true)
})

const shape = (items: TocItem[]): string => items.map((i) => (i.children.length ? `${i.text}(${shape(i.children)})` : i.text)).join(' ')

describe('[[toc]] marker', () => {
  it('depth, case, spaces', () => {
    expect(parseTocMarker('[[toc]]')).toEqual({ depth: 3 })
    expect(parseTocMarker('[[TOC depth=2]]')).toEqual({ depth: 2 })
    expect(parseTocMarker(' [[ toc  depth = 9 ]] ')).toEqual({ depth: 6 })
    expect(parseTocMarker('[[toc.md]]')).toBeNull()
    expect(parseTocMarker('[[Toc|Inhalt]]')).toBeNull()
  })

  it('a block of its own, saved exactly as written', () => {
    const md = '# Buch\n\n[[toc depth=2]]\n\nText mit [[toc]] im Satz.\n'
    const { doc, meta } = importMarkdown(md)
    expect(doc.child(1).type.name).toBe('toc')
    expect(doc.child(1).attrs.raw).toBe('[[toc depth=2]]')
    expect(doc.child(2).type.name).toBe('paragraph')
    expect(exportMarkdown(doc, meta)).toBe(md)
  })

  it('a new one is written as the marker', () => {
    const { doc, meta } = importMarkdown('# A\n')
    const toc = doc.type.schema.nodes.toc.create({ raw: '[[toc]]' })
    const next = doc.copy(doc.content.append(doc.type.schema.nodes.doc.create(null, toc).content))
    expect(exportMarkdown(next, meta)).toBe('# A\n\n[[toc]]\n')
  })

  it('only with the extended syntax or wiki links (GitHub: text)', () => {
    setExtendedSyntax(false)
    setWikiLinks(null)
    expect(importMarkdown('[[toc]]\n').doc.child(0).type.name).toBe('paragraph')
    setWikiLinks(true)
    expect(importMarkdown('[[toc]]\n').doc.child(0).type.name).toBe('toc')
  })
})

describe('headings of a Markdown text', () => {
  it('ATX and setext, code and front matter skipped, inline Markdown removed, GitHub anchors', () => {
    const md = '---\ntitle: x\n---\n# Titel\n\n```\n# kein Titel\n```\n\n## **Fett** und [Link](x.md)\n\nUnter\n---\n\n## Unter\n\n#### Tief'
    const h = headingsOf(md)
    expect(h.map((x) => `${x.level}:${x.text}:${x.slug}`)).toEqual(['1:Titel:titel', '2:Fett und Link:fett-und-link', '2:Unter:unter', '2:Unter:unter-1', '4:Tief:tief'])
    expect(headingsOf(md, 2)).toHaveLength(4)
    expect(plainText('[[sub/Kapitel|Das Kapitel]] `code` ==mark==')).toBe('Das Kapitel code mark')
  })

  it('nested by level', () => {
    const items = nestHeadings(headingsOf('# A\n## B\n### C\n## D\n# E'), (s) => `#${s}`)
    expect(shape(items)).toBe('A(B(C) D) E')
    expect(items[0].children[0].children[0].href).toBe('#c')
  })
})

describe('the table of contents of a workspace', () => {
  const docs = [
    { path: 'teil 2/Kapitel 10.md', markdown: '# Zehn\n## Z1' },
    { path: 'teil 2/Kapitel 2.md', markdown: '# Zwei' },
    { path: 'kapitel1.md', markdown: '# Eins\n## Anfang\n### Detail' },
    { path: 'README.md', markdown: 'Ohne Überschrift' },
    { path: 'anhang.md', markdown: '## Nur Ebene 2' },
  ]
  it('like the tree: README first, natural order, folders after the files; titles and headings', () => {
    const items = workspaceToc(docs, 3, (p, s) => `${p}${s ? '#' + s : ''}`)
    expect(shape(items)).toBe('README anhang(Nur Ebene 2) Eins(Anfang(Detail)) teil 2(Zwei Zehn(Z1))')
    expect(items[2].href).toBe('kapitel1.md')
    expect(items[2].children[0].href).toBe('kapitel1.md#anfang')
    expect(items[3].folder).toBe(true)
  })
  it('depth 1: only the documents', () => {
    expect(shape(workspaceToc(docs, 1, (p) => p))).toBe('README anhang Eins teil 2(Zwei Zehn)')
  })
})

describe('HTML export', () => {
  it('[[toc]] becomes the headings of the document, or what is given', () => {
    const html = renderHtml('# A\n\n[[toc depth=2]]\n\n## B\n\n### C\n')
    expect(html).toContain('<nav class="toc"')
    expect(html).toContain('<a href="#b">B</a>')
    expect(html).not.toContain('#c')
    expect(renderHtml('[[toc]]\n', { toc: (d) => `<nav>ws ${d}</nav>` })).toBe('<nav>ws 3</nav>')
  })
})

describe('several documents in one page (workspace PDF)', () => {
  it('the order of the table of contents', () => {
    const paths = ['teil 2/Kapitel 10.md', 'teil 2/a/x.md', 'teil 2/Kapitel 2.md', 'kapitel1.md', 'README.md', 'anhang.md']
    expect(workspaceOrder(paths.map((path) => ({ path }))).map((d) => d.path)).toEqual(['README.md', 'anhang.md', 'kapitel1.md', 'teil 2/Kapitel 2.md', 'teil 2/Kapitel 10.md', 'teil 2/a/x.md'])
  })

  it('ids get the document prefix, links to other documents become in-page links', () => {
    const resolve = (href: string) => (href.startsWith('kapitel1.md') ? `#d1-${href.split('#')[1]}` : null)
    const md = '# Start\n\n[oben](#start) [K](kapitel1.md#anfang) [[kapitel1#anfang]] [fremd](http://x.y) [weg](fehlt.md)\n'
    const html = renderHtml(md, { links: { prefix: 'd0-', resolve } })
    expect(html).toContain('<h1 id="d0-start">')
    expect(html).toContain('<a href="#d0-start">oben</a>')
    expect(html).toContain('<a href="#d1-anfang">K</a>')
    expect(html).toContain('<a href="#d1-anfang" class="wikilink">')
    expect(html).toContain('<a href="http://x.y">fremd</a>')
    expect(html).toContain('<a href="fehlt.md">weg</a>')
  })
})
