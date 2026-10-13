import { afterEach, describe, expect, it } from 'vitest'
import { findByName, parseWorkspace, relativePath, rootOf, serializeWorkspace } from '../src/workspace'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { setExtendedSyntax, setWikiLinks } from '../src/md/markdown'

describe('workspace file', () => {
  it('defaults, and settings it does not know are kept', () => {
    const w = parseWorkspace('\uFEFF{ "root": "docs", "toc": "Inhalt.md", "version": 1 }', 'Scoriet')
    expect(w).toMatchObject({ version: 1, name: 'Scoriet', root: 'docs', wikiLinks: true, toc: 'Inhalt.md' })
    expect(serializeWorkspace(w)).toBe('{\n  "version": 1,\n  "name": "Scoriet",\n  "root": "docs",\n  "wikiLinks": true,\n  "toc": "Inhalt.md"\n}\n')
    expect(() => parseWorkspace('[1]', 'x')).toThrow()
  })

  it('root relative to the .modw', () => {
    expect(rootOf('C:\\wamp\\www\\scoriet\\Scoriet.modw', '.')).toBe('C:\\wamp\\www\\scoriet')
    expect(rootOf('C:\\wamp\\www\\scoriet\\Scoriet.modw', '../docs')).toBe('C:\\wamp\\www\\docs')
    expect(rootOf('/home/a/p/p.modw', 'docs/sub')).toBe('/home/a/p/docs/sub')
    expect(relativePath('C:\\wamp\\www\\scoriet', 'C:\\wamp\\www\\scoriet')).toBe('.')
    expect(relativePath('C:\\wamp\\www\\scoriet', 'C:\\Wamp\\www\\docs\\x')).toBe('../docs/x')
    expect(relativePath('C:\\wamp', 'D:\\docs')).toBe('D:\\docs')
    expect(relativePath('/home/a/p', '/home/a/p/docs')).toBe('docs')
  })
})

describe('[[Link]] by name in the workspace', () => {
  const index = ['README.md', 'docs/Linux.md', 'docs/sub/Linux.md', 'docs/sub/Kapitel.md', 'other/sub/Kapitel.md', 'a.pdf']
  it('nearest match, case-insensitive, with or without .md', () => {
    expect(findByName(index, 'linux')).toBe('docs/Linux.md')
    expect(findByName(index, 'sub/Linux')).toBe('docs/sub/Linux.md')
    expect(findByName(index, 'sub/Kapitel.md')).toBe('docs/sub/Kapitel.md')
    expect(findByName(index, 'readme')).toBe('README.md')
    expect(findByName(index, 'ux')).toBeNull()
    expect(findByName(index, '../Linux')).toBeNull()
  })
})

describe('wiki links switched by the workspace', () => {
  afterEach(() => {
    setWikiLinks(null)
    setExtendedSyntax(true)
  })
  const kinds = (md: string) => {
    const out: string[] = []
    importMarkdown(md).doc.descendants((n) => void out.push(n.type.name))
    return out
  }
  it('on without the extended syntax, off with it – the text stays as written', () => {
    setExtendedSyntax(false)
    setWikiLinks(true)
    expect(kinds('See [[Link]].')).toContain('wikilink')
    setExtendedSyntax(true)
    setWikiLinks(false)
    expect(kinds('See [[Link]].')).not.toContain('wikilink')
    const { doc, meta } = importMarkdown('See [[Link]] and ^sup^.')
    expect(exportMarkdown(doc, meta)).toBe('See [[Link]] and ^sup^.')
  })
})
