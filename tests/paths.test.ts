import { describe, expect, it } from 'vitest'
import { decodePath, encodePath, joinPath, relativeImagePath } from '../src/platform'

describe('paths', () => {
  it('joins and normalizes Windows paths', () => {
    expect(joinPath('C:\\repo\\docs', '../img/a.png')).toBe('C:\\repo\\img\\a.png')
    expect(joinPath('C:\\repo', '/docs/./a.png')).toBe('C:\\repo\\docs\\a.png')
  })

  it('makes image paths relative to the document', () => {
    expect(relativeImagePath('C:\\repo\\docs\\img\\a b.png', 'C:\\repo\\docs\\README.md')).toBe('img/a%20b.png')
    expect(relativeImagePath('C:\\repo\\assets\\x.png', 'C:\\repo\\docs\\README.md')).toBe('../assets/x.png')
    expect(relativeImagePath('D:\\other\\x.png', 'C:\\repo\\README.md')).toBe('D:/other/x.png')
  })

  it('encodes characters that would break the URL, and decodes them back', () => {
    const rel = relativeImagePath('C:\\repo\\img\\C# Notizen?100%.png', 'C:\\repo\\README.md')
    expect(rel).toBe('img/C%23%20Notizen%3F100%25.png')
    expect(decodePath(rel)).toBe('img/C# Notizen?100%.png')
    expect(encodePath('bilder/Übersicht.png')).toBe('bilder/Übersicht.png') // umlauts stay readable
    expect(decodePath('a/100%.png')).toBe('a/100%.png') // literal % survives
  })
})
