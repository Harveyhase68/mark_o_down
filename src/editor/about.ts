// "Über Mark O Down" – copyright, license and imprint.

import * as host from '../platform'
import { openModal } from './modal'

declare const __APP_VERSION__: string

export const HELP_URL = 'https://predl.cc/mark_o_down'
const WEBSITE = 'https://predl.cc'
const LICENSE_URL = 'https://opensource.org/license/mit'
const IMPRINT_URL = 'https://predl.cc/impressum/'

export function showAbout(): Promise<void> {
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.className = 'dialog about'
    box.innerHTML = `
      <div class="about-head">
        <img class="about-logo" src="/icon.svg" alt="" aria-hidden="true">
        <div>
          <h2>Mark O Down</h2>
          <div class="about-version">Version ${__APP_VERSION__} · WYSIWYG-Markdown-Editor</div>
        </div>
      </div>
      <dl>
        <dt>Copyright</dt><dd>© 2026 Alexander Predl</dd>
        <dt>Website</dt><dd><a href="${WEBSITE}">predl.cc</a></dd>
        <dt>Lizenz</dt><dd><a href="${LICENSE_URL}">MIT License</a></dd>
      </dl>
      <h3>Impressum</h3>
      <address>
        Alexander Predl<br>
        Breite Gasse 276<br>
        2272 Niederabsdorf<br>
        Austria<br>
        <a href="${IMPRINT_URL}">predl.cc/impressum</a>
      </address>
      <div class="buttons"><button type="button" class="primary" autofocus>Schließen</button></div>`

    const close = () => {
      modal.close()
      resolve()
    }
    // links open in the system browser (also with Tab + Enter)
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      e.preventDefault()
      void host.openExternal(a.href)
    })
    box.querySelector('button')!.onclick = close
    const modal = openModal(box, { label: 'Über Mark O Down', onCancel: close })
  })
}
