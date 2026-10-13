import { afterEach, describe, expect, it } from 'vitest'
import { fileLink } from '../src/editor/filedrop'
import { setExtendedSyntax, setWikiLinks } from '../src/md/markdown'

describe('a file dropped into the document', () => {
  afterEach(() => {
    setWikiLinks(null)
    setExtendedSyntax(true)
  })
  const doc = 'C:\\Buch\\buch.md'

  it('wiki link relative to the document, without .md', () => {
    expect(fileLink('C:\\Buch\\kapitel1.md', doc, false)?.markdown).toBe('[[kapitel1]]')
    expect(fileLink('C:\\Buch\\teil 2\\Kapitel 3.md', doc, false)?.markdown).toBe('[[teil 2/Kapitel 3]]')
    expect(fileLink('C:\\Anhang\\a.markdown', doc, false)?.markdown).toBe('[[../Anhang/a.markdown]]')
  })

  it('Markdown link without wiki links, or when a wiki link cannot hold the name', () => {
    setWikiLinks(false)
    expect(fileLink('C:\\Buch\\teil 2\\Kapitel 3.md', doc, false)?.markdown).toBe('[Kapitel 3](teil%202/Kapitel%203.md)')
    setWikiLinks(null)
    expect(fileLink('C:\\Buch\\C# [neu].md', doc, false)?.markdown).toBe('[C# [neu]](C%23%20[neu].md)')
    expect(fileLink('D:\\x\\y.md', doc, false)?.markdown).toBe('[y](D:/x/y.md)')
  })

  it('not saved yet: by name in a workspace, else nothing', () => {
    expect(fileLink('C:\\Buch\\kapitel1.md', null, true)?.markdown).toBe('[[kapitel1]]')
    expect(fileLink('C:\\Buch\\kapitel1.md', null, false)).toBeNull()
  })
})
