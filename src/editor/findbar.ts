// Find & replace bar (Strg+F / Strg+H), floating over the top right of the editor.

import type { EditorView } from 'prosemirror-view'
import { EMPTY_QUERY, findNext, replaceAll, replaceCurrent, revealCurrent, searchState, setQuery, type SearchQuery } from './search'

export interface FindBar {
  open(withReplace: boolean): void
  close(): void
  /** F3 / Shift+F3 (opens the bar if there is no search yet). */
  next(dir: 1 | -1): void
  /** Refresh the match counter after document changes. */
  update(): void
  isOpen(): boolean
}

const OPTIONS: { key: keyof Omit<SearchQuery, 'text'>; label: string; title: string }[] = [
  { key: 'caseSensitive', label: 'Aa', title: 'Groß-/Kleinschreibung beachten (Alt+C)' },
  { key: 'wholeWord', label: 'ab|', title: 'Nur ganzes Wort (Alt+W)' },
  { key: 'regex', label: '.*', title: 'Regulärer Ausdruck (Alt+R) – im Ersetzen-Feld $1, $2 … für Gruppen' },
]

export function createFindBar(container: HTMLElement, view: EditorView): FindBar {
  const bar = document.createElement('div')
  bar.className = 'findbar'
  bar.hidden = true
  bar.setAttribute('role', 'search')
  bar.innerHTML = `
    <div class="fb-row">
      <input class="fb-find" type="text" placeholder="Suchen" aria-label="Suchen" spellcheck="false">
      <span class="fb-count" aria-live="polite"></span>
      <button type="button" class="fb-prev" title="Vorheriger Treffer (Umschalt+Enter / Umschalt+F3)" aria-label="Vorheriger Treffer">↑</button>
      <button type="button" class="fb-next" title="Nächster Treffer (Enter / F3)" aria-label="Nächster Treffer">↓</button>
      <span class="fb-options"></span>
      <button type="button" class="fb-toggle" title="Ersetzen ein-/ausblenden (Strg+H)" aria-label="Ersetzen ein-/ausblenden">⇄</button>
      <button type="button" class="fb-close" title="Schließen (Esc)" aria-label="Suche schließen">✕</button>
    </div>
    <div class="fb-row fb-replace-row">
      <input class="fb-replace" type="text" placeholder="Ersetzen durch" aria-label="Ersetzen durch" spellcheck="false">
      <button type="button" class="fb-one" title="Aktuellen Treffer ersetzen (Enter)">Ersetzen</button>
      <button type="button" class="fb-all" title="Alle Treffer ersetzen (Strg+Alt+Enter)">Alle ersetzen</button>
    </div>`
  container.append(bar)

  const $ = <T extends HTMLElement>(sel: string) => bar.querySelector(sel) as T
  const findIn = $<HTMLInputElement>('.fb-find')
  const replaceIn = $<HTMLInputElement>('.fb-replace')
  const count = $('.fb-count')
  const query: SearchQuery = { ...EMPTY_QUERY }

  const optionButtons = OPTIONS.map((o) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fb-opt'
    b.textContent = o.label
    b.title = o.title
    b.setAttribute('aria-label', o.title)
    b.setAttribute('aria-pressed', 'false')
    b.onclick = () => toggle(o.key)
    $('.fb-options').append(b)
    return { ...o, b }
  })

  function toggle(key: keyof Omit<SearchQuery, 'text'>) {
    query[key] = !query[key]
    for (const o of optionButtons) o.b.setAttribute('aria-pressed', String(query[o.key]))
    apply(true)
  }

  function apply(reveal: boolean) {
    query.text = findIn.value
    setQuery(view, { ...query })
    if (reveal) revealCurrent(view)
    update()
  }

  function update() {
    if (bar.hidden) return
    const s = searchState(view.state)
    bar.classList.toggle('fb-error', !!s.error)
    bar.classList.toggle('fb-none', !!query.text && !s.error && !s.matches.length)
    count.textContent = s.error ? 'Ungültiger Ausdruck' : !query.text ? '' : s.matches.length ? `${s.current + 1} von ${s.matches.length}` : 'Keine Treffer'
    count.title = s.error ?? ''
    const none = !s.matches.length
    for (const sel of ['.fb-prev', '.fb-next', '.fb-one', '.fb-all']) $<HTMLButtonElement>(sel).disabled = none
  }

  function open(withReplace: boolean) {
    const wasHidden = bar.hidden
    bar.hidden = false
    bar.classList.toggle('fb-with-replace', withReplace || (!wasHidden && bar.classList.contains('fb-with-replace')))
    // selected text (one line) becomes the search text
    const { from, to } = view.state.selection
    const selected = view.state.doc.textBetween(from, to, '\n')
    if (selected && !selected.includes('\n') && selected.length < 200) findIn.value = selected
    const target = withReplace && findIn.value ? replaceIn : findIn
    target.focus()
    target.select()
    apply(false)
  }

  function close() {
    if (bar.hidden) return
    bar.hidden = true
    setQuery(view, { ...query, text: '' }) // remove highlights, keep the options
    view.focus()
  }

  function next(dir: 1 | -1) {
    if (bar.hidden || !findIn.value) return open(false)
    findNext(view, dir)
    update()
  }

  let timer = 0
  findIn.addEventListener('input', () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => apply(true), 60)
  })
  bar.addEventListener('keydown', (e) => {
    const inReplace = e.target === replaceIn
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Enter' && e.ctrlKey && e.altKey) {
      e.preventDefault()
      doReplaceAll()
    } else if (e.key === 'Enter' && inReplace) {
      e.preventDefault()
      replaceCurrent(view, replaceIn.value)
      update()
    } else if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault()
      next(e.shiftKey ? -1 : 1)
    } else if (e.altKey && !e.ctrlKey) {
      const opt = { c: 'caseSensitive', w: 'wholeWord', r: 'regex' }[e.key.toLowerCase()] as keyof Omit<SearchQuery, 'text'> | undefined
      if (opt) {
        e.preventDefault()
        toggle(opt)
      }
    }
  })

  function doReplaceAll() {
    const n = replaceAll(view, replaceIn.value)
    update()
    if (n) count.textContent = `${n} ersetzt`
  }

  $('.fb-prev').onclick = () => next(-1)
  $('.fb-next').onclick = () => next(1)
  $('.fb-close').onclick = close
  $('.fb-toggle').onclick = () => {
    bar.classList.toggle('fb-with-replace')
    ;(bar.classList.contains('fb-with-replace') ? replaceIn : findIn).focus()
  }
  $('.fb-one').onclick = () => {
    replaceCurrent(view, replaceIn.value)
    update()
  }
  $('.fb-all').onclick = doReplaceAll
  // buttons must not steal the editor selection / input focus flow
  for (const b of bar.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault())

  return { open, close, next, update, isOpen: () => !bar.hidden }
}
