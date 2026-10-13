import { describe, expect, it } from 'vitest'
import { importMarkdown } from '../src/md/document'
import { anchors, findAnchor, parseLinkTarget, slugify } from '../src/md/anchors'

describe('heading anchors like GitHub', () => {
  it('slugify', () => {
    expect(slugify('Installation')).toBe('installation')
    expect(slugify('Linux & macOS')).toBe('linux--macos')
    expect(slugify('Größe ändern (v2.0)!')).toBe('größe-ändern-v20')
    expect(slugify('snake_case und – Gedankenstrich')).toBe('snake_case-und--gedankenstrich')
    expect(slugify('Emoji 😂 Test')).toBe('emoji--test')
  })

  it('repeated headings get -1, -2; HTML anchors count', () => {
    const { doc } = importMarkdown('# Linux\n\n## Linux\n\n### Linux\n\nText <a name="eigen"></a> und <a id=zwei href="#x">x</a>\n')
    expect(anchors(doc).map((a) => a.id)).toEqual(['linux', 'linux-1', 'linux-2', 'eigen', 'zwei'])
  })

  it('findAnchor: as written, encoded, other case, heading text', () => {
    const { doc } = importMarkdown('# Größe ändern\n\n## Linux unter Ubuntu\n')
    expect(findAnchor(doc, 'größe-ändern')?.text).toBe('Größe ändern')
    expect(findAnchor(doc, 'gr%C3%B6%C3%9Fe-%C3%A4ndern')?.text).toBe('Größe ändern')
    expect(findAnchor(doc, 'Linux-unter-Ubuntu')?.text).toBe('Linux unter Ubuntu')
    expect(findAnchor(doc, 'Linux unter Ubuntu')?.text).toBe('Linux unter Ubuntu')
    expect(findAnchor(doc, 'fehlt')).toBeNull()
  })
})

describe('link targets', () => {
  it('kinds', () => {
    expect(parseLinkTarget('#linux')).toEqual({ kind: 'anchor', fragment: 'linux' })
    expect(parseLinkTarget('https://predl.cc')).toEqual({ kind: 'external', url: 'https://predl.cc' })
    expect(parseLinkTarget('mailto:a@b.cc')).toEqual({ kind: 'external', url: 'mailto:a@b.cc' })
    expect(parseLinkTarget('Link.md')).toEqual({ kind: 'file', path: 'Link.md', fragment: null })
    expect(parseLinkTarget('sub/Mein%20Link.md#linux')).toEqual({ kind: 'file', path: 'sub/Mein Link.md', fragment: 'linux' })
    expect(parseLinkTarget('../a.md?x=1#y')).toEqual({ kind: 'file', path: '../a.md', fragment: 'y' })
    expect(parseLinkTarget('C:\\Docs\\a.md')).toEqual({ kind: 'file', path: 'C:\\Docs\\a.md', fragment: null })
    expect(parseLinkTarget('  ')).toBeNull()
  })
})

describe('HTML export: heading ids', () => {
  it('headings get the same ids as in the editor (and on GitHub)', async () => {
    const { renderHtml } = await import('../src/md/html')
    const html = renderHtml('# Größe ändern\n\n## Linux\n\n## Linux\n\n[x](#linux-1)\n')
    expect(html).toContain('<h1 id="größe-ändern">')
    expect(html).toContain('<h2 id="linux">')
    expect(html).toContain('<h2 id="linux-1">')
  })
})
