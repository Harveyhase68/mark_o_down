// Emoji & symbol search over names and keywords (English + German).
// Matches anywhere, also inside words ("ross" → "face with crossed-out eyes");
// several words must all match ("face with" → "face with medical mask" …).

export interface UnicodeData {
  version: { emoji: string; unicode: string; cldr: string; built: string }
  groups: string[]
  /** [char, groupIndex, name en, name de, keywords en "a|b", keywords de "a|b"] */
  items: [string, number, string, string, string, string][]
  /** base emoji → its five skin-tone variants */
  tones: Record<string, string[]>
}

export interface Entry {
  char: string
  group: number
  nameEn: string
  nameDe: string
  keywords: string[]
  isEmoji: boolean
  /** original order (CLDR order for emoji, code point order for symbols) */
  order: number
  names: string
  keys: string
}

export const EMOJI_GROUPS = 9

export function prepare(data: UnicodeData): Entry[] {
  return data.items.map(([char, group, nameEn, nameDe, kwEn, kwDe], order) => {
    const keywords = [...new Set([...kwEn.split('|'), ...kwDe.split('|')].filter(Boolean))]
    return {
      char,
      group,
      nameEn,
      nameDe,
      keywords,
      isEmoji: !data.groups[group].startsWith('Zeichen: '),
      order,
      names: `${nameEn}|${nameDe}`.toLowerCase(),
      keys: `|${keywords.join('|')}|`.toLowerCase(),
    }
  })
}

const WORD_BREAK = /[\s|:\-_,.()'’]/

/** 0 = exact name, 1 = word in name starts with term, 2 = inside a name word,
 *  3 = keyword starts with term, 4 = inside a keyword; -1 = no match. */
function termRank(e: Entry, term: string): number {
  const names = e.names
  if (names.split('|').includes(term)) return 0
  let best = -1
  for (let i = names.indexOf(term); i >= 0; i = names.indexOf(term, i + 1)) {
    if (i === 0 || WORD_BREAK.test(names[i - 1])) return 1
    best = 2
  }
  if (best >= 0) return best
  const k = e.keys.indexOf(term)
  if (k < 0) return -1
  return e.keys.includes('|' + term) ? 3 : 4
}

/** Search; an empty query returns []. Codepoint queries like "U+1F602" or "1f602" work too. */
export function search(entries: Entry[], query: string, limit = 400): Entry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const cp = /^(?:u\+)?([0-9a-f]{4,6})$/.exec(q)
  const terms = q.split(/\s+/)
  const scored: [number, Entry][] = []
  for (const e of entries) {
    let score = 0
    let ok = true
    for (const t of terms) {
      const r = termRank(e, t)
      if (r < 0) {
        ok = false
        break
      }
      score += r
    }
    if (cp && e.char.codePointAt(0) === parseInt(cp[1], 16)) {
      ok = true
      score = -1
    }
    if (e.char === query.trim()) {
      ok = true
      score = -1
    }
    if (ok) scored.push([score + (e.isEmoji ? 0 : 0.5), e])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].order - b[1].order)
  return scored.slice(0, limit).map(([, e]) => e)
}

export function codepoints(ch: string): string {
  return [...ch].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')
}
