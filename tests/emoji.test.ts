import { describe, expect, it } from 'vitest'
import data from '../src/emoji/unicode-data.json'
import { codepoints, prepare, search, type UnicodeData } from '../src/emoji/search'

const entries = prepare(data as unknown as UnicodeData)
const names = (q: string, n = 50) => search(entries, q, n).map((e) => e.nameEn)
const chars = (q: string, n = 50) => search(entries, q, n).map((e) => e.char)

describe('unicode data', () => {
  it('contains emoji and symbols with names', () => {
    expect(entries.filter((e) => e.isEmoji).length).toBeGreaterThan(1800)
    expect(entries.filter((e) => !e.isEmoji).length).toBeGreaterThan(5000)
    expect(entries.every((e) => e.char && e.nameEn)).toBe(true)
  })

  it('offers skin tones for thumbs up', () => {
    expect((data as unknown as UnicodeData).tones['👍']).toHaveLength(5)
  })
})

describe('search', () => {
  it('"sleep" finds sleeping face and more', () => {
    const r = names('sleep')
    expect(r).toContain('sleeping face')
    expect(r).toContain('sleepy face')
  })

  it('"with" finds names containing the word', () => {
    const r = names('with', 500)
    expect(r).toContain('face with medical mask')
    expect(r).toContain('face with thermometer')
  })

  it('matches inside words: "ross" → crossed-out eyes', () => {
    expect(names('ross', 200)).toContain('face with crossed-out eyes')
  })

  it('several words must all match', () => {
    const r = search(entries, 'face mask', 50)
    expect(r[0].nameEn).toBe('face with medical mask')
    expect(r.every((e) => (e.names + e.keys).includes('face') && (e.names + e.keys).includes('mask'))).toBe(true)
  })

  it('finds by keywords, also German', () => {
    expect(chars('laugh')).toContain('😂')
    expect(chars('lachen')).toContain('😂')
    expect(chars('pfeil rechts')).toContain('→')
    expect(chars('währung')).toContain('€')
  })

  it('ranks whole-word name matches first', () => {
    expect(chars('rightwards arrow')[0]).toBe('→')
  })

  it('finds by code point', () => {
    expect(chars('U+1F602')[0]).toBe('😂')
    expect(codepoints('👍🏽')).toBe('U+1F44D U+1F3FD')
  })
})
