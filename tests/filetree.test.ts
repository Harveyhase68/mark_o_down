import { describe, expect, it } from 'vitest'
import { parentDir, pathBelow } from '../src/filetree'

describe('folder tree paths', () => {
  it('parent folder', () => {
    expect(parentDir('C:\\wamp\\www')).toBe('C:\\wamp')
    expect(parentDir('C:\\wamp')).toBe('C:\\')
    expect(parentDir('C:\\')).toBeNull()
    expect(parentDir('/home/alex')).toBe('/home')
    expect(parentDir('/home')).toBe('/')
    expect(parentDir('/')).toBeNull()
    expect(parentDir('\\\\server\\share\\docs')).toBe('\\\\server\\share')
    expect(parentDir('\\\\server\\share')).toBeNull()
  })

  it('folders from the root down to a file', () => {
    expect(pathBelow('C:\\wamp', 'C:\\Wamp\\www\\README.md')).toEqual(['C:\\Wamp\\www', 'C:\\Wamp\\www\\README.md'])
    expect(pathBelow('C:\\', 'C:\\a.md')).toEqual(['C:\\a.md'])
    expect(pathBelow('C:\\wamp', 'D:\\wamp\\a.md')).toBeNull()
    expect(pathBelow('/home', '/home/alex/a.md')).toEqual(['/home/alex', '/home/alex/a.md'])
    expect(pathBelow('/home/al', '/home/alex/a.md')).toBeNull()
  })
})
