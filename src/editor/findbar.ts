// Find & replace bar (Ctrl+F / Ctrl+H), floating over the top right of the editor.

import type { EditorView } from 'prosemirror-view'
import { kbd, t, type MessageKey } from '../i18n'
import { modKey } from './dom'
import { EMPTY_QUERY, findNext, replaceAll, replaceCurrent, revealCurrent, searchState, setQuery, type SearchQuery } from './search'

export interface FindBar {
  open(withReplace: boolean): void
  close(): void
  /** F3 / Shift+F3 (opens the bar if there is no search yet). */
  next(dir: 1 | -1): void
  /** Refresh the match counter after document changes. */
  update(): void
  isOpen(): boolean
  /** Texts in the current language (after a language change). */
  relabel(): void
}

const OPTIONS: { key: keyof Omit<SearchQuery, 'text'>; label: string; title: MessageKey; shortcut: string }[] = [
  { key: 'caseSensitive', label: 'Aa', title: 'find.case', shortcut: 'Alt+C' },
  { key: 'wholeWord', label: 'ab|', title: 'find.word', shortcut: 'Alt+W' },
  { key: 'regex', label: '.*', title: 'find.regex', shortcut: 'Alt+R' },
]

export function createFindBar(container: HTMLElement, view: EditorView): FindBar {
  const bar = document.createElement('div')
  bar.className = 'findbar'
  bar.hidden = true
  bar.setAttribute('role', 'search')
  bar.innerHTML = `
    <div class="fb-row">
      <input class="fb-find" type="text" spellcheck="false">
      <span class="fb-count" aria-live="polite"></span>
      <button type="button" class="fb-prev">↑</button>
      <button type="button" class="fb-next">↓</button>
      <span class="fb-options"></span>
      <button type="button" class="fb-toggle">⇄</button>
      <button type="button" class="fb-close">✕</button>
    </div>
    <div class="fb-row fb-replace-row">
      <input class="fb-replace" type="text" spellcheck="false">
      <button type="button" class="fb-one"></button>
      <button type="button" class="fb-all"></button>
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
    count.textContent = s.error
      ? t('find.invalid')
      : !query.text
        ? ''
        : s.matches.length
          ? t('find.count', { current: s.current + 1, total: s.matches.length })
          : t('find.none')
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
    } else if (e.key === 'Enter' && modKey(e) && e.altKey) {
      e.preventDefault()
      doReplaceAll()
    } else if (e.key === 'Enter' && inReplace) {
      e.preventDefault()
      replaceCurrent(view, replaceIn.value)
      update()
    } else if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault()
      next(e.shiftKey ? -1 : 1)
    } else if (e.altKey && !modKey(e)) {
      // by key position: on macOS Option+C types "ç"
      const opt = { KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regex' }[e.code] as keyof Omit<SearchQuery, 'text'> | undefined
      if (opt) {
        e.preventDefault()
        toggle(opt)
      }
    }
  })

  function doReplaceAll() {
    const n = replaceAll(view, replaceIn.value)
    update()
    if (n) count.textContent = t('find.replaced', { n })
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

  /** Tooltips and labels in the current language. */
  function relabel() {
    const set = (sel: string, text: string, tooltip = text) => {
      const e = $(sel)
      e.title = tooltip
      e.setAttribute('aria-label', text)
    }
    findIn.placeholder = t('find.label')
    findIn.setAttribute('aria-label', t('find.label'))
    replaceIn.placeholder = t('find.replaceLabel')
    replaceIn.setAttribute('aria-label', t('find.replaceLabel'))
    set('.fb-prev', t('find.prev'), `${t('find.prev')} (${kbd('Shift+Enter')} / ${kbd('Shift')}+F3)`)
    set('.fb-next', t('find.next'), `${t('find.next')} (${kbd('Enter')} / F3)`)
    set('.fb-toggle', t('find.toggleReplace'), `${t('find.toggleReplace')} (${kbd('Ctrl+H')})`)
    set('.fb-close', t('find.close'), `${t('common.close')} (${kbd('Esc')})`)
    $('.fb-one').textContent = t('find.replaceOne')
    $('.fb-one').title = `${t('find.replaceOneTip')} (${kbd('Enter')})`
    $('.fb-all').textContent = t('find.replaceAll')
    $('.fb-all').title = `${t('find.replaceAllTip')} (${kbd('Ctrl+Alt+Enter')})`
    for (const o of optionButtons) {
      o.b.title = `${t(o.title)} (${kbd(o.shortcut)})`
      o.b.setAttribute('aria-label', t(o.title))
    }
    update()
  }
  relabel()

  return { open, close, next, update, isOpen: () => !bar.hidden, relabel }
}
