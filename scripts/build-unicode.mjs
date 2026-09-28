// Builds src/emoji/unicode-data.json from the official sources:
//   • Unicode emoji-test.txt   – every RGI emoji, its group and English name
//   • Unicode UnicodeData.txt  – names of all other symbols / punctuation / number forms
//   • Unicode Blocks.txt       – block names used to group the symbols
//   • CLDR annotations (en/de) – short names + search keywords ("lachen", "lol", …)
//
// Run `npm run unicode` to update to the latest Unicode/CLDR release.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'emoji', 'unicode-data.json')

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

const GROUPS_DE = {
  'Smileys & Emotion': 'Smileys & Gefühle',
  'People & Body': 'Menschen & Körper',
  'Animals & Nature': 'Tiere & Natur',
  'Food & Drink': 'Essen & Trinken',
  'Travel & Places': 'Reisen & Orte',
  Activities: 'Aktivitäten',
  Objects: 'Objekte',
  Symbols: 'Symbole',
  Flags: 'Flaggen',
}

const TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'].map((h) => String.fromCodePoint(parseInt(h, 16)))

async function text(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

const json = async (url) => JSON.parse(await text(url))
const fromHex = (hex) => String.fromCodePoint(...hex.trim().split(/\s+/).map((h) => parseInt(h, 16)))
const stripVS = (s) => s.replace(/️/g, '')

console.log('Lade Unicode- und CLDR-Daten …')
const [emojiTest, unicodeData, blocksTxt, readme, cldrPkg, ...cldr] = await Promise.all([
  text(SOURCES.emojiTest),
  text(SOURCES.unicodeData),
  text(SOURCES.blocks),
  text(SOURCES.readme),
  json(SOURCES.cldrPackage),
  json(SOURCES.cldr('base', 'en')),
  json(SOURCES.cldr('derived', 'en')),
  json(SOURCES.cldr('base', 'de')),
  json(SOURCES.cldr('derived', 'de')),
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
const cldrDe = annotations(cldr[2], cldr[3])

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
  const de = cldrDe.get(stripVS(ch))
  items.push([ch, groupIndex(GROUPS_DE[group] ?? group), nameEn, de?.name ?? '', (en?.keywords ?? []).join('|'), (de?.keywords ?? []).join('|')])
}
// keep tone lists only when all five tones exist
for (const [k, v] of Object.entries(tones)) if (v.length !== 5) delete tones[k]
const emojiCount = items.length

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
  const de = cldrDe.get(ch)
  const nameEn = f[1].toLowerCase()
  items.push([ch, groupIndex(`Zeichen: ${blockOf(cp)}`), nameEn, de?.name ?? '', (en?.keywords ?? []).filter((k) => k.toLowerCase() !== nameEn).join('|'), (de?.keywords ?? []).join('|')])
}

// ------------------------------------------------------------------ write

const unicodeVersion = /Version ([\d.]+) of the Unicode Standard/.exec(readme)?.[1] ?? /(\d+\.\d+\.\d+)/.exec(readme)?.[1] ?? '?'
const data = {
  source: 'Unicode emoji-test.txt, UnicodeData.txt, Blocks.txt; CLDR annotations (en, de)',
  version: { emoji: emojiVersion, unicode: unicodeVersion, cldr: cldrPkg.version, built: new Date().toISOString().slice(0, 10) },
  // item: [char, groupIndex, name (en), name (de), keywords en "a|b", keywords de "a|b"]
  groups,
  items,
  tones,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(data))
console.log(
  `Fertig: ${emojiCount} Emojis, ${items.length - emojiCount} Symbole/Zeichen, ${Object.keys(tones).length} mit Hautfarben – ` +
    `Emoji ${emojiVersion}, Unicode ${unicodeVersion}, CLDR ${cldrPkg.version}\n→ ${OUT}`,
)
