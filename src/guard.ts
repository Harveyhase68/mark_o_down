// Protection against data loss:
//  • external changes – the file on disk is compared with what was loaded;
//    checked when the window gets focus and every few seconds while it has it
//  • crash recovery   – unsaved changes are copied to the app data folder
//    (never to the document itself) and offered after a crash
//  • session          – closing the app keeps the document, unsaved changes
//    included, as such a copy; the next start continues with it (Notepad++ style)

import * as host from './platform'
import { askChoice } from './editor/dialog'
import { modalOpen } from './editor/modal'
import { store } from './editor/dom'
import { locale, t } from './i18n'

const SESSION_KEY = 'mod-session'

/** Remember the document (also unsaved) when the app is closed? On by default. */
export const sessionEnabled = () => store.get<boolean>(SESSION_KEY, true)
export const setSessionEnabled = (on: boolean) => store.set(SESSION_KEY, on)

export interface GuardedDoc {
  path: string | null
  diskHash: string | null
  eol: host.Eol
  bom: boolean
}

export interface GuardDeps {
  doc: () => GuardedDoc
  isDirty: () => boolean
  markdown: () => string
  /** Load the file from disk again (keeps cursor/scroll). */
  reload: () => Promise<void>
  /** Show a recovered document (unsaved), or reopen its file (`markdown` null); false if there was nothing to show. */
  restore: (data: host.RecoveryData) => Promise<boolean>
  /** Save or discard the current document's changes first; false = cancelled. */
  confirmDiscard: () => Promise<boolean>
  /** Cursor and scroll position, kept with a session. */
  position: () => { cursor: number; scroll: number }
  /** A save/close decision from the user is pending → don't interrupt. */
  busy: () => boolean
  flash: (message: string) => void
  markChanged: () => void
}

const CHECK_INTERVAL = 4000
const RECOVERY_DELAY = 1500

export function createGuard(deps: GuardDeps) {
  let checking = false
  /** A change the user already decided on ("keep mine") – don't ask again. */
  let acknowledged: string | null = null
  let recoveryTimer = 0
  let recoveryWritten = false

  // ------------------------------------------------------------ external changes

  async function checkDisk() {
    const doc = deps.doc()
    if (!host.isTauri || !doc.path || checking || deps.busy() || modalOpen()) return
    checking = true
    try {
      const hash = await host.fileHash(doc.path)
      const current = deps.doc()
      // document switched or saved meanwhile, or nothing new
      if (current.path !== doc.path || hash === current.diskHash || hash === acknowledged) return

      if (hash === null) {
        acknowledged = null
        deps.flash(t('guard.deleted'))
        current.diskHash = null
        deps.markChanged()
        return
      }
      if (!deps.isDirty()) {
        // nothing of ours to lose: take the new version silently (like VS Code)
        await deps.reload()
        deps.flash(t('guard.reloaded'))
        return
      }
      const choice = await askChoice(
        t('guard.changedTitle', { name: host.basename(doc.path) }),
        t('guard.changedText'),
        [
          { label: t('guard.reload'), value: 'reload', danger: true },
          { label: t('guard.keepMine'), value: 'keep', primary: true },
        ],
      )
      if (choice === 'reload') await deps.reload()
      else acknowledged = hash
    } finally {
      checking = false
    }
  }

  window.addEventListener('focus', () => void checkDisk())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkDisk())
  window.setInterval(() => document.hasFocus() && void checkDisk(), CHECK_INTERVAL)

  /** The user has seen the current disk version (e.g. cancelled the overwrite question): don't ask again for it. */
  async function acknowledgeDisk() {
    const path = deps.doc().path
    if (path) acknowledged = await host.fileHash(path).catch(() => null)
  }

  /** Save refused because the file changed on disk: what now? */
  async function askOverwrite(name: string): Promise<'overwrite' | 'saveAs' | 'cancel'> {
    const choice = await askChoice(
      t('guard.conflictTitle', { name }),
      t('guard.conflictText'),
      [
        { label: t('guard.overwrite'), value: 'overwrite', danger: true },
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('common.saveAs'), value: 'saveAs', primary: true },
      ],
    )
    return choice as 'overwrite' | 'saveAs' | 'cancel'
  }

  // ------------------------------------------------------------ crash recovery

  /** Call on every document change: keeps the recovery copy up to date. */
  function onChange() {
    if (!host.isTauri) return
    clearTimeout(recoveryTimer)
    recoveryTimer = window.setTimeout(() => {
      if (deps.isDirty()) {
        recoveryWritten = true
        void host.recoveryWrite(snapshot(false)).catch(() => {})
      } else if (recoveryWritten) void clearRecovery()
    }, RECOVERY_DELAY)
  }

  /** The document as a recovery copy; `markdown` only if it has unsaved changes. */
  function snapshot(session: boolean): host.RecoveryData {
    const doc = deps.doc()
    const { cursor, scroll } = deps.position()
    return {
      path: doc.path,
      markdown: deps.isDirty() ? deps.markdown() : null,
      eol: doc.eol,
      bom: doc.bom,
      diskHash: doc.diskHash,
      savedAt: Date.now(),
      session,
      cursor,
      scroll,
    }
  }

  /**
   * Closing the app with "remember session" on (like Notepad++): keep the document
   * as it is – unsaved changes included – for the next start. The file itself is
   * not touched.
   */
  async function saveSession(): Promise<void> {
    clearTimeout(recoveryTimer)
    const doc = deps.doc()
    if (!deps.isDirty() && !doc.path) return clearRecovery() // an empty new document: nothing to keep
    recoveryWritten = true
    await host.recoveryWrite(snapshot(true)).catch(() => {})
  }

  /** Saved, closed or discarded: the recovery copy is no longer needed. */
  function clearRecovery(): Promise<void> {
    clearTimeout(recoveryTimer)
    recoveryWritten = false
    acknowledged = null
    return host.recoveryClear().catch(() => {})
  }

  /**
   * At startup: continue the last session (the newest one, silently – unless a file
   * was opened with the app), then offer unsaved changes left by crashes or by other
   * windows that were closed with unsaved changes.
   */
  async function offerRecovery(opts: { fileOpened: boolean }) {
    const copies = (await host.recoveryOrphans().catch(() => [])).sort((a, b) => b.data.savedAt - a.data.savedAt)
    const session = opts.fileOpened ? undefined : copies.find((c) => c.data.session)
    if (session) {
      const ok = await deps.restore(session.data)
      await host.recoveryRemove(session.id).catch(() => {})
      if (ok && session.data.markdown !== null) {
        onChange() // our own recovery copy takes over
        deps.flash(t('session.restored', { name: session.data.path ? host.basename(session.data.path) : t('doc.untitled') }))
      }
    }
    for (const { id, data } of copies) {
      if (id === session?.id) continue
      // a saved file of an older session: nothing to recover
      if (data.markdown === null) {
        await host.recoveryRemove(id).catch(() => {})
        continue
      }
      const name = data.path ? host.basename(data.path) : t('doc.untitled')
      const when = new Date(data.savedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
      const choice = await askChoice(
        t('guard.recoverTitle'),
        t(data.session ? 'guard.recoverSessionText' : 'guard.recoverText', { name, when }),
        [
          { label: t('common.discard'), value: 'discard', danger: true },
          { label: t('common.later'), value: 'cancel' },
          { label: t('guard.restore'), value: 'restore', primary: true },
        ],
      )
      if (choice === 'cancel') continue // keep it for the next start
      // the document shown now may have unsaved changes too: save or discard them first
      if (choice === 'restore' && !(await deps.confirmDiscard())) continue
      if (choice === 'restore') await deps.restore(data)
      await host.recoveryRemove(id).catch(() => {})
      if (choice === 'restore') onChange()
    }
  }

  return { checkDisk, acknowledgeDisk, askOverwrite, onChange, clearRecovery, offerRecovery, saveSession }
}
