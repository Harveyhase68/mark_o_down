import { describe, expect, it } from 'vitest'
import { MAX_RECENT, addRecent, clearRecent, recentFiles, removeRecent, shortDir } from '../src/recent'

describe('recently opened files', () => {
  it('newest first, no duplicates (Windows paths are case-insensitive), at most 10', async () => {
    await clearRecent()
    for (let i = 1; i <= 12; i++) await addRecent(`C:\\docs\\file${i}.md`)
    await addRecent('c:/DOCS/FILE5.md') // same file as file5
    const list = await recentFiles()
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toBe('c:/DOCS/FILE5.md')
    expect(list.filter((p) => p.toLowerCase().includes('file5'))).toHaveLength(1)
    expect(list).not.toContain('C:\\docs\\file1.md') // pushed out
  })

  it('removes entries', async () => {
    await clearRecent()
    await addRecent('C:\\a\\x.md')
    await addRecent('C:\\a\\y.md')
    await removeRecent('C:\\A\\X.MD')
    expect(await recentFiles()).toEqual(['C:\\a\\y.md'])
  })

  it('shortens long folders for the menu', () => {
    expect(shortDir('C:\\Users\\messe\\Projekte\\mark_o_down\\README.md')).toBe('…\\Projekte\\mark_o_down')
    expect(shortDir('C:\\docs\\a.md')).toBe('C:\\docs')
    expect(shortDir('/home/me/Projekte/mark_o_down/README.md')).toBe('…/Projekte/mark_o_down')
  })
})
