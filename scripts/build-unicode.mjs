// Builds the emoji/symbol data from the official sources:
//   • Unicode emoji-test.txt   – every RGI emoji, its group and English name
//   • Unicode UnicodeData.txt  – names of all other symbols / punctuation / number forms
//   • Unicode Blocks.txt       – block names used to group the symbols
//   • CLDR annotations         – short names + search keywords ("lachen", "lol", …)
//
// Output: src/emoji/unicode-data.json (characters, groups, English names and
// keywords) and src/emoji/unicode-<lang>.json per UI language (names and
// keywords in that language, in the same order as the items).
//
// Run `npm run unicode` to update to the latest Unicode/CLDR release.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'emoji')
const OUT = join(DIR, 'unicode-data.json')
/** UI languages besides English (see src/i18n). */
const LANGS = ['de', 'fr', 'es', 'it']

const SOURCES = {
  emojiTest: 'https://unicode.org/Public/emoji/latest/emoji-test.txt',
  unicodeData: 'https://unicode.org/Public/UCD/latest/ucd/UnicodeData.txt',
  blocks: 'https://unicode.org/Public/UCD/latest/ucd/Blocks.txt',
  readme: 'https://unicode.org/Public/UCD/latest/ucd/ReadMe.txt',
  cldr: (kind, lang) =>
    kind === 'base'
      ? `https://cdn.jsdelivr.net/npm/cldr-annotations-full@latest/annotations/${lang}/annotations.json`
      : `https://cdn.jsdelivr.net/npm/cldr-annotations-derived-full@latest/annotationsDerived/${lang}/annotations.json`,
  cldrPackage: 'https://cdn.jsdelivr.net/npm/cldr-annotations-full@latest/package.json',
}

// General categories of non-emoji characters we offer (symbols, punctuation, number forms).
const SYMBOL_CATEGORIES = new Set(['Sm', 'Sc', 'Sk', 'So', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'No', 'Nl'])

const TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'].map((h) => String.fromCodePoint(parseInt(h, 16)))

async function text(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

const json = async (url) => JSON.parse(await text(url))
const fromHex = (hex) => String.fromCodePoint(...hex.trim().split(/\s+/).map((h) => parseInt(h, 16)))
const stripVS = (s) => s.replace(/️/g, '')

console.log('Loading Unicode and CLDR data …')
const [emojiTest, unicodeData, blocksTxt, readme, cldrPkg, ...cldr] = await Promise.all([
  text(SOURCES.emojiTest),
  text(SOURCES.unicodeData),
  text(SOURCES.blocks),
  text(SOURCES.readme),
  json(SOURCES.cldrPackage),
  ...['en', ...LANGS].flatMap((l) => [json(SOURCES.cldr('base', l)), json(SOURCES.cldr('derived', l))]),
])

/** CLDR annotations per language, keyed by the character without VS16. */
function annotations(base, derived) {
  const out = new Map()
  for (const src of [base.annotations.annotations, derived.annotationsDerived.annotations]) {
    for (const [ch, a] of Object.entries(src)) out.set(stripVS(ch), { name: a.tts?.[0] ?? '', keywords: a.default ?? [] })
  }
  return out
}
const cldrEn = annotations(cldr[0], cldr[1])
const cldrLocal = Object.fromEntries(LANGS.map((l, i) => [l, annotations(cldr[2 + 2 * i], cldr[3 + 2 * i])]))
/** Per language: name and keywords of every item (filled alongside `items`). */
const local = Object.fromEntries(LANGS.map((l) => [l, { names: [], keywords: [] }]))
function addLocal(ch) {
  for (const l of LANGS) {
    const a = cldrLocal[l].get(stripVS(ch))
    local[l].names.push(a?.name ?? '')
    local[l].keywords.push((a?.keywords ?? []).join('|'))
  }
}

// ------------------------------------------------------------------ emoji

const groups = []
const groupIndex = (name) => {
  let i = groups.indexOf(name)
  if (i < 0) i = groups.push(name) - 1
  return i
}

const items = []
const tones = {}
const emojiChars = new Set()
let group = ''
let emojiVersion = /^# Version: ([\d.]+)/m.exec(emojiTest)?.[1] ?? '?'

for (const line of emojiTest.split('\n')) {
  const g = /^# group: (.+)$/.exec(line)
  if (g) {
    group = g[1].trim()
    continue
  }
  const m = /^([0-9A-F ]+?)\s*; fully-qualified\s*# (\S+) E[\d.]+ (.+)$/.exec(line)
  if (!m || group === 'Component') continue
  const ch = fromHex(m[1])
  const nameEn = m[3].trim()
  emojiChars.add(stripVS(ch))
  // single skin-tone variants are offered through the tone selector, not as own entries
  const toneless = TONES.reduce((s, t) => s.replace(t, ''), ch)
  const toneCount = [...ch].filter((c) => TONES.includes(c)).length
  if (toneCount === 1 && toneless !== ch) {
    const base = items.find((it) => it[0] === toneless || stripVS(it[0]) === stripVS(toneless))
    if (base) (tones[base[0]] ??= []).push(ch)
    continue
  }
  if (toneCount > 1) continue // mixed tones (e.g. couples): too many to list
  const en = cldrEn.get(stripVS(ch))
  items.push([ch, groupIndex(group), nameEn, (en?.keywords ?? []).join('|')])
  addLocal(ch)
}
// keep tone lists only when all five tones exist
for (const [k, v] of Object.entries(tones)) if (v.length !== 5) delete tones[k]
const emojiCount = items.length
if (groups.length !== 9) throw new Error(`expected 9 emoji groups, got ${groups.join(', ')}`) // EMOJI_GROUPS in search.ts

// ------------------------------------------------------------------ symbols

const blocks = blocksTxt
  .split('\n')
  .map((l) => /^([0-9A-F]+)\.\.([0-9A-F]+); (.+)$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ from: parseInt(m[1], 16), to: parseInt(m[2], 16), name: m[3].trim() }))
const blockOf = (cp) => blocks.find((b) => cp >= b.from && cp <= b.to)?.name ?? 'Other'

for (const line of unicodeData.split('\n')) {
  const f = line.split(';')
  if (f.length < 3) continue
  const cp = parseInt(f[0], 16)
  const cat = f[2]
  if (!SYMBOL_CATEGORIES.has(cat) || cp < 0xa0 || f[1].startsWith('<')) continue
  const ch = String.fromCodePoint(cp)
  if (emojiChars.has(ch)) continue
  const en = cldrEn.get(ch)
  const nameEn = f[1].toLowerCase()
  items.push([ch, groupIndex(blockOf(cp)), nameEn, (en?.keywords ?? []).filter((k) => k.toLowerCase() !== nameEn).join('|')])
  addLocal(ch)
}

// ------------------------------------------------------------------ write

const unicodeVersion = /Version ([\d.]+) of the Unicode Standard/.exec(readme)?.[1] ?? /(\d+\.\d+\.\d+)/.exec(readme)?.[1] ?? '?'
const data = {
  source: 'Unicode emoji-test.txt, UnicodeData.txt, Blocks.txt; CLDR annotations (en)',
  version: { emoji: emojiVersion, unicode: unicodeVersion, cldr: cldrPkg.version, built: new Date().toISOString().slice(0, 10) },
  // groups: the 9 emoji groups, then the Unicode blocks of the symbols
  // item: [char, groupIndex, name (en), keywords (en) "a|b"]
  groups,
  items,
  tones,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(data))
for (const l of LANGS) writeFileSync(join(DIR, `unicode-${l}.json`), JSON.stringify({ lang: l, ...local[l] }))
console.log(
  `Done: ${emojiCount} emoji, ${items.length - emojiCount} symbols, ${Object.keys(tones).length} with skin tones – ` +
    `Emoji ${emojiVersion}, Unicode ${unicodeVersion}, CLDR ${cldrPkg.version}\n→ ${DIR} (${['en', ...LANGS].join(', ')})`,
)
