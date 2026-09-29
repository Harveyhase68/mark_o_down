// Translations. German (de.ts) is the reference: every other language must have
// exactly the same keys (TypeScript enforces it). Texts may contain {name}
// placeholders; keyboard shortcuts are written the English way ("Ctrl+Shift+S")
// and localised with kbd().

import { de, type MessageKey } from './de'
import { en } from './en'
import { fr } from './fr'
import { es } from './es'
import { it } from './it'
import { isMac, store } from '../editor/dom'

export type Lang = 'de' | 'en' | 'fr' | 'es' | 'it'
export type { MessageKey }
export type Messages = Record<MessageKey, string>

export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
]

const DICTIONARIES: Record<Lang, Messages> = { de, en, fr, es, it }
const KEY = 'mod-lang'

/** Saved choice, else the Windows/browser language, else English. */
function detect(): Lang {
  const saved = typeof localStorage !== 'undefined' ? store.get<string | null>(KEY, null) : null
  if (saved && saved in DICTIONARIES) return saved as Lang
  const nav = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const l of nav) {
    const code = l.slice(0, 2).toLowerCase()
    if (code in DICTIONARIES) return code as Lang
  }
  return 'en'
}

let lang: Lang = detect()
const listeners = new Set<() => void>()

export const getLang = () => lang

/** Switch the language; registered parts of the UI redraw themselves. */
export function setLang(l: Lang) {
  if (l === lang) return
  lang = l
  store.set(KEY, l)
  if (typeof document !== 'undefined') document.documentElement.lang = l
  for (const fn of listeners) fn()
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Translated text; `{name}` placeholders are filled from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang][key] ?? de[key] ?? key
  return params ? text.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m)) : text
}

/** Text in a given language (not the current one), without placeholders. */
export const tIn = (l: Lang, key: MessageKey): string => DICTIONARIES[l][key] ?? de[key] ?? key

/** macOS symbols, in the order macOS shows modifiers (⌥⇧⌘). */
const MAC_KEYS: Record<string, [number, string]> = { Alt: [0, '⌥'], Shift: [1, '⇧'], Ctrl: [2, '⌘'] }

/**
 * "Ctrl+Shift+S" in the words of the current language ("Strg+Umschalt+S", "Ctrl+Maj+S" …);
 * on macOS with symbols and Cmd instead of Ctrl ("⇧⌘S").
 */
export function kbd(combo: string, mac = isMac): string {
  if (mac) {
    const parts = combo.split('+')
    const mods = parts.filter((p) => MAC_KEYS[p]).sort((a, b) => MAC_KEYS[a][0] - MAC_KEYS[b][0])
    const rest = parts.filter((p) => !MAC_KEYS[p]).map((p) => (p === 'Enter' ? '↩' : p === 'Esc' ? 'esc' : p === 'Tab' ? '⇥' : p))
    return mods.map((m) => MAC_KEYS[m][1]).join('') + rest.join('+')
  }
  const words: Record<string, MessageKey> = { Ctrl: 'key.ctrl', Shift: 'key.shift', Alt: 'key.alt', Enter: 'key.enter', Esc: 'key.esc', Tab: 'key.tab' }
  return combo
    .split('+')
    .map((part) => (words[part] ? t(words[part]) : part))
    .join('+')
}

/** Locale for number/date formatting. */
export const locale = () => ({ de: 'de-AT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' })[lang]

/** For tests: switch without persisting. */
export function _setLangForTests(l: Lang) {
  lang = l
}
