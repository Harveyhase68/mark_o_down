// JSON editor for badges.json (opened from the image picker).

import { CONFIG_FILE, DEFAULT_CONFIG, configText, saveConfig, type PickerConfig } from './config'
import * as host from '../platform'
import { el } from '../editor/dom'
import { openModal } from '../editor/modal'

/** Resolves with the saved config, or null if cancelled. */
export function editConfig(text: string): Promise<PickerConfig | null> {
  return new Promise((resolve) => {
    const area = el('textarea', { spellcheck: 'false', 'aria-label': CONFIG_FILE })
    area.value = text
    const error = el('p', { class: 'pk-error', hidden: '', role: 'alert' })
    const save = el('button', { type: 'button', class: 'primary' }, 'Speichern')
    const cancel = el('button', { type: 'button' }, 'Abbrechen')
    const reset = el('button', { type: 'button' }, 'Standard wiederherstellen')
    const folder = el('button', { type: 'button' }, 'Im Explorer zeigen')
    folder.hidden = !host.isTauri
    const box = el(
      'div',
      { class: 'dialog cfg-editor' },
      el('h2', {}, `Badge- & Icon-Quellen (${CONFIG_FILE})`),
      el(
        'p',
        { class: 'pk-empty' },
        'Anbieter, Vorlagen und Icon-Sets als JSON. Platzhalter: {feld}, {feld|raw}, {feld|shields}, {feld|hex}. ' +
          'Leere Query-Parameter werden entfernt. "cacheHours" = wie lange Icon-Listen zwischengespeichert werden. ' +
          'Tab rückt ein; Esc schließt ohne Speichern.',
      ),
      area,
      error,
      el('div', { class: 'buttons' }, folder, reset, cancel, save),
    )

    const close = (c: PickerConfig | null) => {
      modal.close()
      resolve(c)
    }
    cancel.onclick = () => close(null)
    reset.onclick = () => {
      area.value = configText(DEFAULT_CONFIG)
      error.hidden = true
    }
    folder.onclick = () => void host.revealConfigFile(CONFIG_FILE)
    save.onclick = async () => {
      try {
        close(await saveConfig(area.value))
      } catch (e) {
        error.hidden = false
        error.textContent = `Nicht gespeichert: ${(e as Error).message}`
      }
    }
    box.addEventListener('keydown', (e) => {
      if (e.key === 's' && e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        save.click()
      }
    })
    // Tab indents inside the JSON (instead of leaving the field)
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end')
      }
    })

    // closing by clicking outside would lose edits: only Esc / Abbrechen
    const modal = openModal(box, { label: `${CONFIG_FILE} bearbeiten`, onCancel: () => close(null), closeOnBackdrop: false })
    area.focus()
  })
}
