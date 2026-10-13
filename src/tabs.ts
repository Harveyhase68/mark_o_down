// The tab bar above the document: one tab per open document. Click to switch, × or the
// middle mouse button to close, drag to reorder, right-click for more; ● marks unsaved
// changes (× when the pointer is on it). Double-click on the empty bar: a new tab.

import { el } from './editor/dom'
import { kbd, t } from './i18n'

export interface TabInfo {
  id: number
  name: string
  /** the folder, when another tab has the same name */
  hint: string
  /** tooltip: the path */
  title: string
  dirty: boolean
  active: boolean
}

export interface TabBarHooks {
  activate: (id: number) => void
  close: (id: number) => void
  create: () => void
  menu: (id: number, anchor: HTMLElement) => void
  /** dragged to another place */
  move: (id: number, index: number) => void
}

export function createTabBar(bar: HTMLElement, hooks: TabBarHooks) {
  const strip = el('div', { class: 'tab-strip', role: 'tablist' })
  const add = el('button', { type: 'button', class: 'tab-new' }, '+')
  bar.replaceChildren(strip, add)
  add.onclick = () => hooks.create()

  let shown = ''
  let tabs: TabInfo[] = []

  function render(next: TabInfo[]) {
    add.title = `${t('tabs.new')} (${kbd('Ctrl+N')} / ${kbd('Ctrl+T')})`
    add.setAttribute('aria-label', add.title)
    const key = JSON.stringify(next) + add.title
    if (key === shown || drag?.moved) return
    shown = key
    tabs = next
    strip.replaceChildren(
      ...next.map((tab) => {
        const close = el('button', { type: 'button', class: 'tab-close', tabindex: '-1', title: t('tabs.close'), 'aria-label': t('tabs.close') })
        const node = el('div', { class: 'tab', role: 'tab', 'aria-selected': String(tab.active), title: tab.title, 'data-id': String(tab.id) }, el('span', { class: 'tab-name' }, tab.name))
        if (tab.hint) node.append(el('span', { class: 'tab-hint' }, tab.hint))
        node.append(close)
        node.classList.toggle('active', tab.active)
        node.classList.toggle('dirty', tab.dirty)
        return node
      }),
    )
    strip.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const tabAt = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.tab')
  const idOf = (node: HTMLElement) => +node.dataset.id!

  // ---------------------------------------------------------------- mouse

  let drag: { id: number; x: number; pointer: number; moved: boolean; node: HTMLElement } | null = null

  strip.addEventListener('pointerdown', (e) => {
    const node = tabAt(e)
    if (!node || e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return
    hooks.activate(idOf(node))
    drag = { id: idOf(node), x: e.clientX, pointer: e.pointerId, moved: false, node: strip.querySelector<HTMLElement>(`.tab[data-id="${idOf(node)}"]`) ?? node }
  })
  strip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < 6) return
      drag.moved = true
      strip.setPointerCapture(e.pointerId)
      drag.node = strip.querySelector<HTMLElement>(`.tab[data-id="${drag.id}"]`) ?? drag.node
      drag.node.classList.add('dragging')
    }
    drag.node.style.transform = `translateX(${e.clientX - drag.x}px)`
  })
  const endDrag = (e: PointerEvent) => {
    const d = drag
    drag = null
    if (!d?.moved) return
    d.node.classList.remove('dragging')
    d.node.style.transform = ''
    // the new place: before the first tab whose middle is right of the pointer
    const others = [...strip.querySelectorAll<HTMLElement>('.tab')].filter((n) => n !== d.node)
    let index = others.findIndex((n) => {
      const r = n.getBoundingClientRect()
      return e.clientX < r.left + r.width / 2
    })
    if (index < 0) index = others.length
    shown = ''
    hooks.move(d.id, index)
  }
  strip.addEventListener('pointerup', endDrag)
  strip.addEventListener('pointercancel', endDrag)

  strip.addEventListener('click', (e) => {
    const node = tabAt(e)
    if (node && (e.target as HTMLElement).closest('.tab-close')) hooks.close(idOf(node))
  })
  // middle button: close (and no auto-scroll cursor)
  strip.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault())
  strip.addEventListener('auxclick', (e) => {
    const node = tabAt(e)
    if (node && e.button === 1) hooks.close(idOf(node))
  })
  strip.addEventListener('contextmenu', (e) => {
    const node = tabAt(e)
    if (!node) return
    e.preventDefault()
    hooks.menu(idOf(node), node)
  })
  bar.addEventListener('dblclick', (e) => {
    if (!tabAt(e) && !(e.target as HTMLElement).closest('button')) hooks.create()
  })
  // the wheel scrolls many tabs sideways
  strip.addEventListener(
    'wheel',
    (e) => {
      if (strip.scrollWidth <= strip.clientWidth) return
      e.preventDefault()
      strip.scrollLeft += e.deltaY || e.deltaX
    },
    { passive: false },
  )

  return {
    render,
    /** the tab element of `id` (anchor for its menu) */
    element: (id: number) => strip.querySelector<HTMLElement>(`.tab[data-id="${id}"]`),
    tabs: () => tabs,
  }
}
