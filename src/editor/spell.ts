// Spell checking in the visual editor, with the operating system's checker (see
// src-tauri/src/spell.rs). Own red underlines and own right-click menu (in the app's
// language); the language of the texts is chosen separately from the interface
// language. Not checked: code, formulas, diagrams, raw HTML, front matter, and words
// that look technical (URLs, paths, file names, CamelCase, ALLCAPS, words with digits).

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import * as host from '../platform'
import { store } from './dom'
import { getLang, locale, t, type Lang } from '../i18n'
import { openMenu, type MenuItem } from './dialog'

// ------------------------------------------------------------------ settings

const ENABLED_KEY = 'mod-spell'
const LANG_KEY = 'mod-spell-lang'

/** On by default; switched off it stays off (saved). */
export const spellEnabled = () => store.get<boolean>(ENABLED_KEY, true)
export const setSpellEnabled = (on: boolean) => store.set(ENABLED_KEY, on)

let available: string[] | null = null

/** Languages with a dictionary on this computer (BCP 47 tags). */
export async function spellLanguages(): Promise<string[]> {
  available ??= await host.spellLanguages().catch(() => [])
  return available
}

const REGION: Record<Lang, string> = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' }

/** The language of the texts: the one chosen, else (until one is chosen) the interface language's. */
export function spellLanguage(): string | null {
  const list = available ?? []
  const chosen = store.get<string | null>(LANG_KEY, null)
  if (chosen && list.includes(chosen)) return chosen
  const gui = getLang()
  const family = (tag: string) => tag.split('-')[0].toLowerCase()
  return (
    navigator.languages.find((l) => list.includes(l) && family(l) === gui) ?? // e.g. de-AT from Windows
    (list.includes(REGION[gui]) ? REGION[gui] : undefined) ??
    list.find((l) => family(l) === gui) ??
    list.find((l) => l === 'en-US') ??
    list[0] ??
    null
  )
}

export const setSpellLanguage = (tag: string) => store.set(LANG_KEY, tag)

/** "Deutsch (Österreich)" for de-AT, in the interface language. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

// ------------------------------------------------------------------ personal dictionary

const personal = new Map<string, Set<string>>()
const ignored = new Set<string>() // this session, all languages

const dictFile = (lang: string) => `spelling-${lang}.txt`

async function personalWords(lang: string): Promise<Set<string>> {
  let words = personal.get(lang)
  if (!words) {
    const text = await host.configRead(dictFile(lang)).catch(() => null)
    words = new Set((text ?? '').split(/\r?\n/).filter(Boolean))
    personal.set(lang, words)
  }
  return words
}

async function addToDictionary(lang: string, word: string) {
  const words = await personalWords(lang)
  words.add(word)
  await host.configWrite(dictFile(lang), [...words].sort((a, b) => a.localeCompare(b)).join('\n') + '\n').catch(() => {})
}

// ------------------------------------------------------------------ words

/** Not prose: links, paths, file names, e-mail addresses, things with digits or `_`. */
const TECHNICAL = /[/\\@_\d]|:\/\/|\.\p{L}/u
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu

/** Each word worth checking in a text block, with its document positions. */
export function eachWord(doc: PMNode, fn: (word: string, from: number, to: number) => void) {
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false // code, formulas, diagrams, raw HTML, front matter
    // the block's text, position for position: other inline nodes and code become blanks
    let text = ''
    node.forEach((child) => {
      const blank = !child.isText || child.marks.some((m) => m.type.name === 'code')
      text += blank ? ' '.repeat(child.nodeSize) : child.text!
    })
    for (const token of text.matchAll(/\S+/g)) {
      if (TECHNICAL.test(token[0])) continue
      for (const w of token[0].matchAll(WORD)) {
        const word = w[0]
        // single letters, ALLCAPS, CamelCase (GitHub, iPhone): names and abbreviations
        if (word.length < 2 || /\p{Lu}/u.test(word.slice(1))) continue
        const from = pos + 1 + token.index! + w.index!
        fn(word, from, from + word.length)
      }
    }
    return false
  })
}

// ------------------------------------------------------------------ checking

/** lang → word → spelled correctly */
const results = new Map<string, Map<string, boolean>>()
const queue = new Set<string>()

function decorations(doc: PMNode): DecorationSet {
  const lang = spellEnabled() ? spellLanguage() : null
  if (!lang) return DecorationSet.empty
  const known = results.get(lang) ?? new Map<string, boolean>()
  results.set(lang, known)
  const mine = personal.get(lang)
  const decos: Decoration[] = []
  eachWord(doc, (word, from, to) => {
    if (ignored.has(word) || mine?.has(word)) return
    const ok = known.get(word)
    if (ok === undefined) queue.add(word)
    else if (!ok) decos.push(Decoration.inline(from, to, { class: 'spell-error' }, { word }))
  })
  return DecorationSet.create(doc, decos)
}

const key = new PluginKey<DecorationSet>('spell')

/** Recompute the underlines (language or setting changed, words checked). */
export function refreshSpell(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
}

const BATCH = 400

export function spellPlugin() {
  let timer = 0
  let busy = false

  /** Ask the system checker about the words not known yet, a batch at a time. */
  async function checkQueue(view: EditorView) {
    if (busy) return
    const lang = spellLanguage()
    if (!lang || !queue.size) return
    busy = true
    try {
      await personalWords(lang)
      const known = results.get(lang)!
      while (queue.size) {
        const words = [...queue].slice(0, BATCH)
        words.forEach((w) => queue.delete(w))
        const answers = await host.spellCheck(lang, words).catch(() => words.map(() => true))
        words.forEach((w, i) => known.set(w, answers[i]))
      }
    } finally {
      busy = false
    }
    if (!view.isDestroyed) refreshSpell(view)
  }

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => decorations(state.doc),
      apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorations(tr.doc) : old.map(tr.mapping, tr.doc)),
    },
    props: {
      decorations: (state) => key.getState(state),
      handleDOMEvents: {
        // right-click on an underlined word: our menu (suggestions, dictionary, ignore)
        contextmenu(view, event) {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const deco = at && key.getState(view.state)?.find(at.pos, at.pos).find((d) => d.from <= at.pos && at.pos <= d.to)
          if (!deco) return false
          event.preventDefault()
          void showSpellMenu(view, deco.from, deco.to, event.clientX, event.clientY)
          return true
        },
      },
    },
    view(view) {
      void spellLanguages().then(() => !view.isDestroyed && refreshSpell(view))
      const schedule = () => {
        clearTimeout(timer)
        if (queue.size) timer = window.setTimeout(() => void checkQueue(view), 250)
      }
      schedule()
      return { update: schedule, destroy: () => clearTimeout(timer) }
    },
  })
}

// ------------------------------------------------------------------ menus

/** An invisible element at the mouse position: the menu opens below it. */
function pointAnchor(x: number, y: number): HTMLElement {
  let el = document.getElementById('spell-anchor')
  if (!el) {
    el = document.createElement('div')
    el.id = 'spell-anchor'
    el.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none'
    document.body.append(el)
  }
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  return el
}

async function showSpellMenu(view: EditorView, from: number, to: number, x: number, y: number) {
  const lang = spellLanguage()
  if (!lang) return
  const word = view.state.doc.textBetween(from, to)
  const suggestions = await host.spellSuggest(lang, word).catch(() => [])
  const replace = (s: string) => () => {
    view.dispatch(view.state.tr.insertText(s, from, to))
    view.focus()
  }
  const items: MenuItem[] = suggestions.length
    ? suggestions.map((s) => ({ label: s, run: replace(s) }))
    : [{ label: t('spell.noSuggestions'), disabled: true, run: () => {} }]
  items.push(
    'separator',
    { label: t('spell.add'), title: languageName(lang), run: () => void addToDictionary(lang, word).then(() => refreshSpell(view)) },
    { label: t('spell.ignore'), run: () => (ignored.add(word), refreshSpell(view)) },
    'separator',
    { label: t('spell.disable'), run: () => (setSpellEnabled(false), refreshSpell(view)) },
  )
  openMenu(pointAnchor(x, y), items)
}

const FAMILIES: Lang[] = ['de', 'en', 'fr', 'es', 'it']

/** The language choice (Help menu): dictionaries on this computer for the five languages. */
export async function showLanguageMenu(view: EditorView, anchor: HTMLElement) {
  const list = await spellLanguages()
  const current = spellLanguage()
  const hint = t(/Windows/.test(navigator.userAgent) ? 'spell.installWindows' : /Mac/.test(navigator.userAgent) ? 'spell.installMac' : 'spell.installLinux')
  const items: MenuItem[] = [{ label: t('spell.languages'), disabled: true, run: () => {} }]
  for (const family of FAMILIES) {
    const tags = list.filter((l) => l.split('-')[0].toLowerCase() === family).sort()
    if (!tags.length) {
      items.push({ label: `   ${languageName(family)} – ${t('spell.notInstalled')}`, title: hint, disabled: true, run: () => {} })
      continue
    }
    for (const tag of tags) {
      items.push({
        label: `${tag === current ? '✓' : ' '}  ${languageName(tag)}`,
        shortcut: tag,
        run: () => {
          setSpellLanguage(tag)
          if (!spellEnabled()) setSpellEnabled(true)
          refreshSpell(view)
        },
      })
    }
  }
  openMenu(anchor, items)
}
