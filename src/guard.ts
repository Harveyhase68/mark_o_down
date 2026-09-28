// Protection against data loss:
//  • external changes – the file on disk is compared with what was loaded;
//    checked when the window gets focus and every few seconds while it has it
//  • crash recovery   – unsaved changes are copied to the app data folder
//    (never to the document itself) and offered after a crash

import * as host from './platform'
import { askChoice } from './editor/dialog'
import { modalOpen } from './editor/modal'
import { locale, t } from './i18n'

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
  /** Show a recovered document (unsaved). */
  restore: (data: host.RecoveryData) => void
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
        const doc = deps.doc()
        recoveryWritten = true
        void host.recoveryWrite({ path: doc.path, markdown: deps.markdown(), eol: doc.eol, bom: doc.bom, diskHash: doc.diskHash, savedAt: Date.now() }).catch(() => {})
      } else if (recoveryWritten) void clearRecovery()
    }, RECOVERY_DELAY)
  }

  /** Saved, closed or discarded: the recovery copy is no longer needed. */
  function clearRecovery(): Promise<void> {
    clearTimeout(recoveryTimer)
    recoveryWritten = false
    acknowledged = null
    return host.recoveryClear().catch(() => {})
  }

  /** At startup: offer copies left behind by a crash. */
  async function offerRecovery() {
    for (const { id, data } of await host.recoveryOrphans().catch(() => [])) {
      const name = data.path ? host.basename(data.path) : t('doc.untitled')
      const when = new Date(data.savedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
      const choice = await askChoice(
        t('guard.recoverTitle'),
        t('guard.recoverText', { name, when }),
        [
          { label: t('common.discard'), value: 'discard', danger: true },
          { label: t('common.later'), value: 'cancel' },
          { label: t('guard.restore'), value: 'restore', primary: true },
        ],
      )
      if (choice === 'cancel') continue // keep it for the next start
      if (choice === 'restore') deps.restore(data)
      await host.recoveryRemove(id).catch(() => {})
      if (choice === 'restore') {
        onChange() // our own recovery copy takes over
        return
      }
    }
  }

  return { checkDisk, acknowledgeDisk, askOverwrite, onChange, clearRecovery, offerRecovery }
}
