// "Über Mark O Down" – copyright, license and imprint.

import * as host from '../platform'
import { openModal } from './modal'
import { t } from '../i18n'

declare const __APP_VERSION__: string

export const HELP_URL = 'https://predl.cc/mark_o_down'
const WEBSITE = 'https://predl.cc'
const LICENSE_URL = 'https://opensource.org/license/mit'
const IMPRINT_URL = 'https://predl.cc/impressum/'

/** The licenses of the components the app is built with (generated at build time, loaded on demand). */
async function showLicenses(): Promise<void> {
  const text = await fetch('/third-party-licenses.txt')
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null)
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.className = 'dialog licenses'
    const h2 = document.createElement('h2')
    h2.textContent = t('about.thirdParty')
    const body = document.createElement(text ? 'pre' : 'p')
    body.className = 'licenses-text'
    body.tabIndex = 0 // scrollable with the keyboard
    body.textContent = text ?? t('about.thirdPartyMissing')
    const buttons = document.createElement('div')
    buttons.className = 'buttons'
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'primary'
    ok.textContent = t('common.close')
    buttons.append(ok)
    box.append(h2, body, buttons)
    const close = () => {
      modal.close()
      resolve()
    }
    ok.onclick = close
    const modal = openModal(box, { label: t('about.thirdParty'), onCancel: close })
    body.focus()
  })
}

export function showAbout(): Promise<void> {
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.className = 'dialog about'
    box.innerHTML = `
      <div class="about-head">
        <img class="about-logo" src="/icon.svg" alt="" aria-hidden="true">
        <div>
          <h2>Mark O Down</h2>
          <div class="about-version">${t('about.version')} ${__APP_VERSION__} · ${t('about.subtitle')}</div>
        </div>
      </div>
      <dl>
        <dt>Copyright</dt><dd>© 2026 Alexander Predl</dd>
        <dt>${t('about.website')}</dt><dd><a href="${WEBSITE}">predl.cc</a></dd>
        <dt>${t('about.license')}</dt><dd><a href="${LICENSE_URL}">MIT License</a></dd>
        <dt>Open Source</dt><dd><a href="#third-party" data-licenses>${t('about.thirdParty')}</a></dd>
      </dl>
      <h3>${t('about.imprint')}</h3>
      <address>
        Alexander Predl<br>
        Breite Gasse 276<br>
        2272 Niederabsdorf<br>
        Austria<br>
        <a href="${IMPRINT_URL}">predl.cc/impressum</a>
      </address>
      <div class="buttons"><button type="button" class="primary" autofocus>${t('common.close')}</button></div>`

    const close = () => {
      modal.close()
      resolve()
    }
    // links open in the system browser (also with Tab + Enter)
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      e.preventDefault()
      if (a.hasAttribute('data-licenses')) void showLicenses()
      else void host.openExternal(a.href)
    })
    box.querySelector('button')!.onclick = close
    const modal = openModal(box, { label: t('menu.about'), onCancel: close })
  })
}
