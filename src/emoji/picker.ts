// Emoji & symbol dialog: search (EN/DE, inside words), groups, skin tones,
// recently used. Resolves with the character(s) to insert, or null.

import { EMOJI_GROUPS, codepoints, prepare, search, type Entry, type UnicodeData } from './search'
import { el, store } from '../editor/dom'
import { openModal } from '../editor/modal'

let cache: { data: UnicodeData; entries: Entry[] } | null = null
async function load() {
  if (!cache) {
    // separate chunk: only loaded when the dialog is opened
    const data = (await import('./unicode-data.json')).default as unknown as UnicodeData
    cache = { data, entries: prepare(data) }
  }
  return cache
}

const RECENT_KEY = 'mod-emoji-recent'
const TONE_KEY = 'mod-emoji-tone'
const TONE_SWATCHES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const TONE_NAMES = ['Standard', 'hell', 'mittelhell', 'mittel', 'mitteldunkel', 'dunkel']

let lastGroup: number | 'recent' = 0
let lastQuery = ''

export function openEmojiPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const box = el('div', { class: 'emoji-picker' })
    const closeX = el('button', { type: 'button', class: 'ep-x', title: 'Schließen (Esc)', 'aria-label': 'Schließen' }, '✕')
    const input = el('input', { type: 'search', placeholder: 'Suchen … z. B. sleep, lachen, pfeil, with, U+1F602', spellcheck: 'false' })
    const toneBox = el('div', { class: 'ep-tones', role: 'radiogroup', 'aria-label': 'Hautfarbe' })
    const tabs = el('nav', { class: 'ep-tabs' })
    const status = el('div', { class: 'ep-status' }, 'Lade Unicode-Daten …')
    const grid = el('div', { class: 'ep-grid', role: 'listbox', tabindex: '0', 'aria-label': 'Zeichen – Pfeiltasten wählen, Enter fügt ein' })
    const big = el('div', { class: 'ep-big' })
    const info = el('div', { class: 'ep-info' })
    const cancel = el('button', { type: 'button' }, 'Abbrechen')
    const ok = el('button', { type: 'button', class: 'primary' }, 'Einfügen')
    box.append(
      el('header', {}, el('h2', {}, 'Emoji & Zeichen'), closeX),
      el('div', { class: 'ep-search' }, input, toneBox),
      tabs,
      status,
      grid,
      el('footer', {}, big, info, el('div', { class: 'buttons' }, cancel, ok)),
    )
    const modal = openModal(box, { label: 'Emoji & Zeichen einfügen', onCancel: () => close(null) })
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
      const b = el('button', { type: 'button', role: 'radio', title: `Hautfarbe: ${TONE_NAMES[i]}`, 'aria-checked': String(i === tone) }, s)
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
      const title = el('strong', {}, e.nameDe || e.nameEn)
      const sub = el('span', {}, [e.nameDe ? e.nameEn : '', codepoints(ch)].filter(Boolean).join(' · '))
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
      const b = el('button', { type: 'button', class: e.isEmoji ? 'ep-tile' : 'ep-tile ep-sym', role: 'option', title: e.nameDe || e.nameEn, 'data-i': String(i), tabindex: '-1' }, withTone(e))
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
      for (const t of tabs.children) t.setAttribute('aria-selected', String(!q && (t as HTMLElement).dataset.g === String(lastGroup)))
      if (q) {
        const hits = search(entries, q, 600)
        status.textContent = hits.length ? `${hits.length === 600 ? '600+' : hits.length} Treffer für „${q}“` : `Keine Treffer für „${q}“`
        return show(hits)
      }
      if (lastGroup === 'recent') {
        const recent = store.get<string[]>(RECENT_KEY, [])
        const byChar = new Map(entries.map((e) => [e.char, e]))
        const list = recent.map((c) => byChar.get(c)).filter((e): e is Entry => !!e)
        status.textContent = list.length ? 'Zuletzt verwendet' : 'Noch nichts verwendet.'
        return show(list)
      }
      if (lastGroup === EMOJI_GROUPS) {
        // all symbol blocks, with block headings
        const list = entries.filter((e) => !e.isEmoji)
        status.textContent = `${list.length} Zeichen in ${data.groups.length - EMOJI_GROUPS} Unicode-Blöcken`
        let prev = -1
        return show(list, (e) => (e.group !== prev ? ((prev = e.group), data!.groups[e.group].replace(/^Zeichen: /, '')) : null))
      }
      const list = entries.filter((e) => e.group === lastGroup)
      status.textContent = `${data.groups[lastGroup as number]} · ${list.length}`
      show(list)
    }

    // ------------------------------------------------------------ events
    let timer = 0
    input.oninput = () => {
      clearTimeout(timer)
      timer = window.setTimeout(render, 80)
    }
    grid.onclick = (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (t) select(Number(t.dataset.i), false)
    }
    grid.ondblclick = (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (t) insert(shown[Number(t.dataset.i)])
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
      // Enter inserts – except on a focused button (Abbrechen, a tab …), which does its own thing
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
      tab('recent', '🕘', 'Zuletzt verwendet')
      for (let g = 0; g < EMOJI_GROUPS; g++) {
        const first = entries.find((e) => e.group === g)
        tab(g, first?.char ?? '•', c.data.groups[g])
      }
      tab(EMOJI_GROUPS, 'Ω', 'Zeichen & Symbole (alle Unicode-Blöcke)')
      box.dataset.version = `Emoji ${c.data.version.emoji} · Unicode ${c.data.version.unicode} · CLDR ${c.data.version.cldr}`
      render()
    })
  })
}
