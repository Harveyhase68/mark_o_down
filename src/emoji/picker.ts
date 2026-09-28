// Emoji & symbol dialog: search (English + UI language, inside words), groups, skin tones,
// recently used. Resolves with the character(s) to insert, or null.

import { EMOJI_GROUPS, codepoints, prepare, search, type Entry, type UnicodeData, type UnicodeNames } from './search'
import { el, store } from '../editor/dom'
import { openModal } from '../editor/modal'
import { getLang, kbd, t, type Lang, type MessageKey } from '../i18n'

// separate chunks: only loaded when the dialog is opened (English is in the base data)
const LOCAL_NAMES: Record<Exclude<Lang, 'en'>, () => Promise<{ default: unknown }>> = {
  de: () => import('./unicode-de.json'),
  fr: () => import('./unicode-fr.json'),
  es: () => import('./unicode-es.json'),
  it: () => import('./unicode-it.json'),
}

let cache: { lang: Lang; data: UnicodeData; entries: Entry[] } | null = null
async function load() {
  const lang = getLang()
  if (cache?.lang !== lang) {
    const data = cache?.data ?? ((await import('./unicode-data.json')).default as unknown as UnicodeData)
    const local = lang === 'en' ? undefined : ((await LOCAL_NAMES[lang]()).default as UnicodeNames)
    cache = { lang, data, entries: prepare(data, local) }
  }
  return cache
}

/** Tab / heading text of a group: emoji groups are translated, Unicode block names stay English. */
const groupName = (data: UnicodeData, g: number) => (g < EMOJI_GROUPS ? t(`emoji.group${g}` as MessageKey) : data.groups[g])

const RECENT_KEY = 'mod-emoji-recent'
const TONE_KEY = 'mod-emoji-tone'
const TONE_SWATCHES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']

let lastGroup: number | 'recent' = 0
let lastQuery = ''

export function openEmojiPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const box = el('div', { class: 'emoji-picker' })
    const closeX = el('button', { type: 'button', class: 'ep-x', title: `${t('common.close')} (${kbd('Esc')})`, 'aria-label': t('common.close') }, '✕')
    const input = el('input', { type: 'search', placeholder: t('emoji.search'), spellcheck: 'false' })
    const toneBox = el('div', { class: 'ep-tones', role: 'radiogroup', 'aria-label': t('emoji.skinTone') })
    const tabs = el('nav', { class: 'ep-tabs' })
    const status = el('div', { class: 'ep-status' }, t('emoji.loading'))
    const grid = el('div', { class: 'ep-grid', role: 'listbox', tabindex: '0', 'aria-label': t('emoji.grid') })
    const big = el('div', { class: 'ep-big' })
    const info = el('div', { class: 'ep-info' })
    const cancel = el('button', { type: 'button' }, t('common.cancel'))
    const ok = el('button', { type: 'button', class: 'primary' }, t('common.insert'))
    box.append(
      el('header', {}, el('h2', {}, t('emoji.title')), closeX),
      el('div', { class: 'ep-search' }, input, toneBox),
      tabs,
      status,
      grid,
      el('footer', {}, big, info, el('div', { class: 'buttons' }, cancel, ok)),
    )
    const modal = openModal(box, { label: t('emoji.label'), onCancel: () => close(null) })
    input.value = lastQuery
    input.focus()

    let tone = store.get<number>(TONE_KEY, 0)
    let shown: Entry[] = []
    let selected = -1
    let data: UnicodeData | null = null
    let entries: Entry[] = []

    const withTone = (e: Entry) => (tone > 0 && data?.tones[e.char] ? data.tones[e.char][tone - 1] : e.char)

    // ------------------------------------------------------------ tones
    TONE_SWATCHES.forEach((s, i) => {
      const b = el('button', { type: 'button', role: 'radio', title: t('emoji.tone', { tone: t(`emoji.tone${i}` as MessageKey) }), 'aria-checked': String(i === tone) }, s)
      b.onclick = () => {
        tone = i
        store.set(TONE_KEY, tone)
        for (const [j, c] of [...toneBox.children].entries()) c.setAttribute('aria-checked', String(j === i))
        render()
      }
      toneBox.append(b)
    })

    // ------------------------------------------------------------ selection / info
    function select(i: number, scroll = true) {
      grid.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false')
      selected = Math.max(-1, Math.min(i, shown.length - 1))
      const tile = grid.querySelector<HTMLElement>(`[data-i="${selected}"]`)
      tile?.setAttribute('aria-selected', 'true')
      if (scroll) tile?.scrollIntoView({ block: 'nearest' })
      const e = shown[selected]
      ok.disabled = !e
      if (!e) {
        big.textContent = ''
        info.replaceChildren()
        return
      }
      const ch = withTone(e)
      big.textContent = ch
      const title = el('strong', {}, e.name || e.nameEn)
      const sub = el('span', {}, [e.name ? e.nameEn : '', codepoints(ch)].filter(Boolean).join(' · '))
      const kw = el('span', { class: 'ep-kw' }, e.keywords.slice(0, 12).join(', '))
      info.replaceChildren(title, sub, kw)
    }

    function insert(e: Entry | undefined = shown[selected]) {
      if (!e) return
      const ch = withTone(e)
      const recent = store.get<string[]>(RECENT_KEY, []).filter((c) => c !== e.char)
      store.set(RECENT_KEY, [e.char, ...recent].slice(0, 48))
      close(ch)
    }

    // ------------------------------------------------------------ rendering
    function tile(e: Entry, i: number): HTMLButtonElement {
      const b = el('button', { type: 'button', class: e.isEmoji ? 'ep-tile' : 'ep-tile ep-sym', role: 'option', title: e.name || e.nameEn, 'data-i': String(i), tabindex: '-1' }, withTone(e))
      return b
    }

    function show(list: Entry[], headers?: (e: Entry) => string | null) {
      shown = list
      const frag = document.createDocumentFragment()
      let section: HTMLElement | null = null
      list.forEach((e, i) => {
        const h = headers?.(e)
        if (h) {
          frag.append(el('h3', {}, h))
          section = null
        }
        if (!section) {
          section = el('div', { class: 'ep-section' })
          frag.append(section)
        }
        section.append(tile(e, i))
      })
      grid.replaceChildren(frag)
      grid.scrollTop = 0
      select(list.length ? 0 : -1, false)
    }

    function render() {
      if (!data) return
      const q = input.value.trim()
      lastQuery = input.value
      for (const b of tabs.children) b.setAttribute('aria-selected', String(!q && (b as HTMLElement).dataset.g === String(lastGroup)))
      if (q) {
        const hits = search(entries, q, 600)
        status.textContent = hits.length ? t('emoji.hits', { n: hits.length === 600 ? '600+' : hits.length, q }) : t('emoji.noHits', { q })
        return show(hits)
      }
      if (lastGroup === 'recent') {
        const recent = store.get<string[]>(RECENT_KEY, [])
        const byChar = new Map(entries.map((e) => [e.char, e]))
        const list = recent.map((c) => byChar.get(c)).filter((e): e is Entry => !!e)
        status.textContent = list.length ? t('emoji.recent') : t('emoji.recentEmpty')
        return show(list)
      }
      if (lastGroup === EMOJI_GROUPS) {
        // all symbol blocks, with block headings
        const list = entries.filter((e) => !e.isEmoji)
        status.textContent = t('emoji.symbolsCount', { n: list.length, blocks: data.groups.length - EMOJI_GROUPS })
        let prev = -1
        return show(list, (e) => (e.group !== prev ? ((prev = e.group), data!.groups[e.group]) : null))
      }
      const list = entries.filter((e) => e.group === lastGroup)
      status.textContent = `${groupName(data, lastGroup as number)} · ${list.length}`
      show(list)
    }

    // ------------------------------------------------------------ events
    let timer = 0
    input.oninput = () => {
      clearTimeout(timer)
      timer = window.setTimeout(render, 80)
    }
    grid.onclick = (ev) => {
      const hit = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (hit) select(Number(hit.dataset.i), false)
    }
    grid.ondblclick = (ev) => {
      const hit = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (hit) insert(shown[Number(hit.dataset.i)])
    }
    const columns = () => {
      const first = grid.querySelector<HTMLElement>('.ep-tile')
      const section = first?.parentElement
      return first && section ? Math.max(1, Math.floor(section.clientWidth / first.offsetWidth)) : 1
    }
    // (Esc, Tab and click outside are handled by the modal frame)
    box.addEventListener('keydown', (e) => {
      const k = e.key
      const onButton = (e.target as HTMLElement).tagName === 'BUTTON'
      // Enter inserts – except on a focused button (Cancel, a tab …), which does its own thing
      if (k === 'Enter' && !onButton) return void (e.preventDefault(), insert())
      const step = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? columns() : k === 'ArrowUp' ? -columns() : 0
      // in the search field left/right move the text cursor
      if (step && !onButton && !(e.target === input && Math.abs(step) === 1)) {
        e.preventDefault()
        select(Math.max(0, selected + step))
      }
    })
    cancel.onclick = () => close(null)
    closeX.onclick = () => close(null)
    ok.onclick = () => insert()

    function close(result: string | null) {
      clearTimeout(timer)
      modal.close()
      resolve(result)
    }

    // ------------------------------------------------------------ load
    void load().then((c) => {
      data = c.data
      entries = c.entries
      const tab = (g: number | 'recent', icon: string, label: string) => {
        const b = el('button', { type: 'button', title: label, 'data-g': String(g) }, icon)
        b.onclick = () => {
          lastGroup = g
          input.value = ''
          render()
          input.focus()
        }
        tabs.append(b)
      }
      tab('recent', '🕘', t('emoji.recent'))
      for (let g = 0; g < EMOJI_GROUPS; g++) {
        const first = entries.find((e) => e.group === g)
        tab(g, first?.char ?? '•', groupName(c.data, g))
      }
      tab(EMOJI_GROUPS, 'Ω', t('emoji.symbols'))
      box.dataset.version = `Emoji ${c.data.version.emoji} · Unicode ${c.data.version.unicode} · CLDR ${c.data.version.cldr}`
      render()
    })
  })
}
