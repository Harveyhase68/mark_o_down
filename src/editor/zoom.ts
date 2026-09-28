// Document zoom: Ctrl+mouse wheel, Ctrl+Plus/Minus, Ctrl+0 (reset), and the
// "− 100 % +" control in the status bar. Only the document is scaled – the
// toolbar and status bar keep their size. The level is remembered.

import { store } from './dom'
import { kbd, t } from '../i18n'

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const KEY = 'mod-zoom'
/** Wheel distance per zoom step (one mouse-wheel notch ≈ 100; touchpad pinch sends small steps). */
const WHEEL_STEP = 60

/** Next zoom level from `current` in direction `dir` (snaps to the step list). */
export function nextZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ?? ZOOM_STEPS[0]
}

export interface Zoom {
  level(): number
  set(level: number): void
  step(dir: 1 | -1): void
  /** Tooltips in the current language. */
  relabel(): void
}

export function setupZoom(target: HTMLElement, scroller: HTMLElement, control: HTMLElement): Zoom {
  let level = clamp(store.get<number>(KEY, 1))

  control.innerHTML = `
    <button type="button" class="zoom-out">−</button>
    <button type="button" class="zoom-level"></button>
    <button type="button" class="zoom-in">+</button>`
  const label = control.querySelector<HTMLButtonElement>('.zoom-level')!
  control.querySelector<HTMLButtonElement>('.zoom-out')!.onclick = () => zoom.step(-1)
  control.querySelector<HTMLButtonElement>('.zoom-in')!.onclick = () => zoom.step(1)
  label.onclick = () => zoom.set(1)
  for (const b of control.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault()) // keep editor focus

  function apply(anchorY?: number) {
    // keep the same spot of the document in view (under the mouse when wheeling)
    const rect = scroller.getBoundingClientRect()
    const y = anchorY !== undefined ? anchorY - rect.top : scroller.clientHeight / 2
    const ratio = (scroller.scrollTop + y) / Math.max(1, scroller.scrollHeight)
    target.style.zoom = String(level)
    scroller.scrollTop = ratio * scroller.scrollHeight - y
    label.textContent = `${Math.round(level * 100)} %`
    control.classList.toggle('zoomed', level !== 1)
  }

  const zoom: Zoom = {
    relabel() {
      const wheel = `${kbd('Ctrl')}+${t('key.wheel')}`
      const out = control.querySelector<HTMLButtonElement>('.zoom-out')!
      const into = control.querySelector<HTMLButtonElement>('.zoom-in')!
      out.title = `${t('zoom.out')} (${kbd('Ctrl')}+Minus / ${wheel})`
      out.setAttribute('aria-label', t('zoom.out'))
      into.title = `${t('zoom.in')} (${kbd('Ctrl')}+Plus / ${wheel})`
      into.setAttribute('aria-label', t('zoom.in'))
      label.title = `${t('zoom.reset')} (${kbd('Ctrl')}+0)`
      control.setAttribute('aria-label', t('zoom.label'))
    },
    level: () => level,
    set(l) {
      level = clamp(l)
      store.set(KEY, level)
      apply()
    },
    step(dir) {
      zoom.set(nextZoom(level, dir))
    },
  }

  // Ctrl + mouse wheel (and touchpad pinch, which arrives as ctrl+wheel)
  let wheel = 0
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault() // no page zoom / scrolling
      wheel += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY // lines → pixels
      if (Math.abs(wheel) < WHEEL_STEP) return
      const dir = wheel < 0 ? 1 : -1
      wheel = 0
      level = clamp(nextZoom(level, dir))
      store.set(KEY, level)
      apply(e.clientY)
    },
    { passive: false },
  )

  // Ctrl + Plus / Minus / 0 (main keyboard and number pad; "=" is Plus on US layouts)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key
      const code = e.code
      let handled = true
      if (k === '+' || k === '=' || code === 'NumpadAdd') zoom.step(1)
      else if (k === '-' || code === 'NumpadSubtract') zoom.step(-1)
      else if ((k === '0' || code === 'Numpad0') && !e.shiftKey) zoom.set(1)
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true,
  )

  zoom.relabel()
  apply()
  return zoom
}

function clamp(l: number): number {
  return Number.isFinite(l) ? Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], l)) : 1
}
