import { describe, expect, it } from 'vitest'
import data from '../src/emoji/unicode-data.json'
import de from '../src/emoji/unicode-de.json'
import fr from '../src/emoji/unicode-fr.json'
import es from '../src/emoji/unicode-es.json'
import it_ from '../src/emoji/unicode-it.json'
import { EMOJI_GROUPS, codepoints, prepare, search, type UnicodeData, type UnicodeNames } from '../src/emoji/search'

const base = data as unknown as UnicodeData
const entries = prepare(base, de as UnicodeNames)
const names = (q: string, n = 50) => search(entries, q, n).map((e) => e.nameEn)
const chars = (q: string, n = 50) => search(entries, q, n).map((e) => e.char)

describe('unicode data', () => {
  it('contains emoji and symbols with names', () => {
    expect(entries.filter((e) => e.isEmoji).length).toBeGreaterThan(1800)
    expect(entries.filter((e) => !e.isEmoji).length).toBeGreaterThan(5000)
    expect(entries.every((e) => e.char && e.nameEn)).toBe(true)
    expect(base.groups.slice(0, EMOJI_GROUPS)).toContain('Smileys & Emotion')
    expect(entries.filter((e) => e.isEmoji).every((e) => e.group < EMOJI_GROUPS)).toBe(true)
  })

  it('has names for every UI language, aligned with the items', () => {
    for (const l of [de, fr, es, it_] as UnicodeNames[]) {
      expect(l.names).toHaveLength(base.items.length)
      expect(l.keywords).toHaveLength(base.items.length)
    }
    const i = base.items.findIndex(([c]) => c === '😂')
    expect((fr as UnicodeNames).keywords[i]).toMatch(/rire/)
    expect((es as UnicodeNames).names[i]).toBeTruthy()
    expect((it_ as UnicodeNames).names[i]).toBeTruthy()
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

  it('searches English plus the chosen language', () => {
    const fromFr = prepare(base, fr as UnicodeNames)
    expect(search(fromFr, 'rire', 50).map((e) => e.char)).toContain('😂')
    expect(search(fromFr, 'laugh', 50).map((e) => e.char)).toContain('😂')
    expect(search(prepare(base), 'lachen', 50).map((e) => e.char)).not.toContain('😂')
  })

  it('finds by code point', () => {
    expect(chars('U+1F602')[0]).toBe('😂')
    expect(codepoints('👍🏽')).toBe('U+1F44D U+1F3FD')
  })
})
