// Protection against data loss:
//  • external changes – the file on disk is compared with what was loaded;
//    checked when the window gets focus and every few seconds while it has it
//  • crash recovery   – unsaved changes are copied to the app data folder
//    (never to the document itself) and offered after a crash
//  • session          – closing the app keeps the open tabs, unsaved changes
//    included, as such a copy; the next start continues with them (Notepad++ style)
// The copy holds all tabs of the window (one file per running instance).

import * as host from './platform'
import { askChoice } from './editor/dialog'
import { modalOpen } from './editor/modal'
import { store } from './editor/dom'
import { locale, t } from './i18n'

const SESSION_KEY = 'mod-session'

/** Remember the open documents (also unsaved) when the app is closed? On by default. */
export const sessionEnabled = () => store.get<boolean>(SESSION_KEY, true)
export const setSessionEnabled = (on: boolean) => store.set(SESSION_KEY, on)

export interface GuardedDoc {
  path: string | null
  diskHash: string | null
  eol: host.Eol
  bom: boolean
}

export interface GuardDeps {
  /** the document in front (the one checked for external changes) */
  doc: () => GuardedDoc
  isDirty: () => boolean
  /** any tab with unsaved changes? */
  anyDirty: () => boolean
  /** all tabs (`markdown` only of those with unsaved changes), and which is in front */
  tabs: () => { tabs: host.RecoveryData[]; active: number }
  /** Load the file from disk again (keeps cursor/scroll). */
  reload: () => Promise<void>
  /** Open a recovered document (unsaved) or reopen its file (`markdown` null) in a tab; its id, null if nothing was opened. */
  restore: (data: host.RecoveryData) => Promise<number | null>
  /** bring a tab to the front */
  activate: (id: number) => void
  /** A save/close decision from the user is pending → don't interrupt. */
  busy: () => boolean
  flash: (message: string) => void
  markChanged: () => void
}

const CHECK_INTERVAL = 4000
const RECOVERY_DELAY = 1500

export function createGuard(deps: GuardDeps) {
  let checking = false
  /** Changes on disk the user already decided on ("keep mine"), by path – don't ask again. */
  const acknowledged = new Map<string, string>()
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
      if (current.path !== doc.path || hash === current.diskHash || hash === acknowledged.get(doc.path)) return

      if (hash === null) {
        acknowledged.delete(doc.path)
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
      else acknowledged.set(doc.path, hash)
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
    const hash = path && (await host.fileHash(path).catch(() => null))
    if (path && hash) acknowledged.set(path, hash)
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

  /** Call on every change (also saving, closing a tab): keeps the recovery copy up to date. */
  function onChange() {
    if (!host.isTauri) return
    clearTimeout(recoveryTimer)
    recoveryTimer = window.setTimeout(() => {
      // also without unsaved changes: the open tabs, in case the page has to be loaded again
      const set = snapshot(false)
      if (set.tabs.some((d) => d.path || d.markdown !== null)) {
        recoveryWritten = true
        void host.recoveryWrite(set).catch(() => {})
      } else if (recoveryWritten) void clearRecovery()
    }, RECOVERY_DELAY)
  }

  /** All tabs as a recovery copy. */
  function snapshot(session: boolean): host.RecoverySet {
    const { tabs, active } = deps.tabs()
    return { version: 2, tabs, active, savedAt: Date.now(), session }
  }

  /**
   * Closing the app with "remember session" on (like Notepad++): keep the tabs as they
   * are – unsaved changes included – for the next start. The files are not touched.
   */
  async function saveSession(): Promise<void> {
    clearTimeout(recoveryTimer)
    const set = snapshot(true)
    // only empty new documents: nothing to keep
    if (!set.tabs.some((d) => d.path || d.markdown !== null)) return clearRecovery()
    recoveryWritten = true
    await host.recoveryWrite(set).catch(() => {})
  }

  /** Saved, closed or discarded: the recovery copy is no longer needed. */
  function clearRecovery(): Promise<void> {
    clearTimeout(recoveryTimer)
    recoveryWritten = false
    return host.recoveryClear().catch(() => {})
  }

  /**
   * At startup: continue the last session (the newest one, silently: its tabs come back),
   * then offer unsaved changes left by crashes or by other windows that were closed with
   * unsaved changes – they open in tabs of their own.
   */
  async function offerRecovery() {
    const names = (tabs: host.RecoveryData[]) => tabs.map((d) => (d.path ? host.basename(d.path) : t('doc.untitled'))).join(', ')
    // our own copy: the page was loaded again (its process crashed) – everything comes back
    const own = await host.recoveryOwn().catch(() => null)
    if (own?.tabs.length) {
      const ids: (number | null)[] = []
      for (const d of own.tabs) ids.push(await deps.restore(d))
      const front = ids[own.active] ?? ids.findLast((id) => id !== null)
      if (front != null) deps.activate(front)
      onChange()
      deps.flash(t('session.reloaded'))
    }
    const copies = (await host.recoveryOrphans().catch(() => [])).sort((a, b) => b.data.savedAt - a.data.savedAt)
    const session = copies.find((c) => c.data.session)
    if (session) {
      const ids: (number | null)[] = []
      for (const d of session.data.tabs) ids.push(await deps.restore(d))
      const front = ids[session.data.active] ?? ids.findLast((id) => id !== null)
      if (front != null) deps.activate(front)
      await host.recoveryRemove(session.id).catch(() => {})
      const unsaved = session.data.tabs.filter((d) => d.markdown !== null)
      if (unsaved.length) {
        onChange() // our own recovery copy takes over
        deps.flash(t('session.restored', { name: names(unsaved) }))
      }
    }
    for (const { id, data } of copies) {
      if (id === session?.id) continue
      const unsaved = data.tabs.filter((d) => d.markdown !== null)
      // only saved files of an older session: nothing to recover
      if (!unsaved.length) {
        await host.recoveryRemove(id).catch(() => {})
        continue
      }
      const when = new Date(data.savedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
      const choice = await askChoice(
        t('guard.recoverTitle'),
        t(data.session ? 'guard.recoverSessionText' : 'guard.recoverText', { name: names(unsaved), when }),
        [
          { label: t('common.discard'), value: 'discard', danger: true },
          { label: t('common.later'), value: 'cancel' },
          { label: t('guard.restore'), value: 'restore', primary: true },
        ],
      )
      if (choice === 'cancel') continue // keep it for the next start
      if (choice === 'restore') {
        // all its tabs come back (the others reopen their files), the one in front stays in front
        const ids: (number | null)[] = []
        for (const d of data.tabs) ids.push(await deps.restore(d))
        const front = ids[data.active] ?? ids.findLast((x) => x !== null)
        if (front != null) deps.activate(front)
      }
      await host.recoveryRemove(id).catch(() => {})
      if (choice === 'restore') onChange()
    }
  }

  return { checkDisk, acknowledgeDisk, askOverwrite, onChange, clearRecovery, offerRecovery, saveSession }
}
