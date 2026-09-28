import { describe, expect, it } from 'vitest'
import { joinPath, relativeImagePath } from '../src/platform'

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
})
