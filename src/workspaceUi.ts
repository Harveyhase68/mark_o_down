// The workspace dialogs: "Open workspace" (favourites on top, all below, each sortable
// by name or date) and the form for a new workspace / its settings.

import * as host from './platform'
import { el, store } from './editor/dom'
import { openDialog } from './editor/dialog'
import { openModal } from './editor/modal'
import { getLang, t } from './i18n'
import { forgetWorkspace, knownWorkspaces, setFavorite, type KnownWorkspace } from './workspace'

// ------------------------------------------------------------------ new workspace / settings

export interface WorkspaceForm {
  name: string
  /** the documents' folder (a new workspace is saved in it) */
  folder: string
  wikiLinks: boolean
}

/** Characters a file name can't have. */
export const safeFileName = (name: string) => name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '')

/**
 * The form. `creating`: the .modw is saved in the folder (shown as it will be written);
 * otherwise the folder is the workspace's documents folder, wherever the .modw is.
 */
export async function workspaceForm(initial: WorkspaceForm, creating: boolean): Promise<WorkspaceForm | null> {
  let folder = initial.folder
  let wikiLinks = initial.wikiLinks
  const res = await openDialog({
    title: creating ? t('ws.newTitle') : t('ws.settingsTitle'),
    fields: [{ name: 'name', label: t('ws.name'), value: initial.name }],
    extra: (box) => {
      const form = box.parentElement!
      const nameInput = form.querySelector<HTMLInputElement>('input[name=name]')!
      const path = el('span', { class: 'ws-folder-path' })
      const file = el('div', { class: 'ws-file' })
      const update = () => {
        path.textContent = folder
        path.title = folder
        const name = safeFileName(nameInput.value)
        file.textContent = creating && name ? t('ws.file', { path: host.joinPath(folder, `${name}.modw`) }) : ''
      }
      const change = el('button', { type: 'button' }, t('ws.change'))
      change.onclick = async () => {
        const picked = await host.pickFolder().catch(() => null)
        if (picked) folder = picked
        update()
      }
      const check = el('input', { type: 'checkbox' })
      check.checked = wikiLinks
      check.onchange = () => (wikiLinks = check.checked)
      nameInput.addEventListener('input', update)
      box.classList.add('ws-form')
      box.append(
        el('div', { class: 'ws-label' }, t('ws.folder')),
        el('div', { class: 'ws-folder' }, path, change),
        el('label', { class: 'ws-check' }, check, el('span', {}, t('ws.wiki'))),
        file,
      )
      update()
    },
  })
  const name = res?.values.name.trim()
  return name ? { name, folder, wikiLinks } : null
}

// ------------------------------------------------------------------ "Open workspace"

export interface WorkspaceWindowHooks {
  /** the open workspace (marked in the list) */
  current: string | null
  open: (path: string) => void
  pickFile: () => void
  create: () => void
}

type SortBy = 'name' | 'date'
interface Sort {
  by: SortBy
  asc: boolean
}
const SORT_KEY = 'mod-ws-sort'

export async function openWorkspaceWindow(hooks: WorkspaceWindowHooks) {
  const sorts = store.get<{ fav: Sort; all: Sort }>(SORT_KEY, { fav: { by: 'name', asc: true }, all: { by: 'date', asc: false } })
  let list = await knownWorkspaces()
  const missing = new Set<string>()

  const box = el('div', { class: 'dialog ws-window' })
  const favList = el('div', { class: 'ws-list' })
  const allList = el('div', { class: 'ws-list' })
  const favSort = el('div', { class: 'ws-sort' })
  const allSort = el('div', { class: 'ws-sort' })
  const pick = el('button', { type: 'button' }, t('ws.pick'))
  const create = el('button', { type: 'button' }, t('ws.new'))
  const close = el('button', { type: 'button', class: 'primary' }, t('common.close'))
  box.append(
    el('h2', {}, t('ws.title')),
    el('section', {}, el('div', { class: 'ws-head' }, el('h3', {}, `★ ${t('ws.favorites')}`), favSort), favList),
    el('section', {}, el('div', { class: 'ws-head' }, el('h3', {}, t('ws.all')), allSort), allList),
    el('div', { class: 'buttons' }, pick, create, close),
  )
  const modal = openModal(box, { label: t('ws.title') })
  const done = (fn: () => void) => {
    modal.close()
    fn()
  }
  close.onclick = () => modal.close()
  pick.onclick = () => done(hooks.pickFile)
  create.onclick = () => done(hooks.create)

  const date = (ms: number) =>
    ms ? new Date(ms).toLocaleString(getLang(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const collator = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' })
  const sorted = (items: KnownWorkspace[], s: Sort) =>
    [...items].sort((a, b) => {
      const d = s.by === 'name' ? collator.compare(a.name, b.name) || collator.compare(a.path, b.path) : a.opened - b.opened
      return s.asc ? d : -d
    })

  function sortButtons(where: HTMLElement, key: 'fav' | 'all') {
    const s = sorts[key]
    where.replaceChildren(
      ...(['name', 'date'] as SortBy[]).map((by) => {
        const active = s.by === by
        const b = el('button', { type: 'button', class: active ? 'active' : '', title: t('ws.sortTip') }, `${t(by === 'name' ? 'ws.sortName' : 'ws.sortDate')} ${active ? (s.asc ? '↑' : '↓') : ''}`.trim())
        b.onclick = () => {
          sorts[key] = active ? { by, asc: !s.asc } : { by, asc: true }
          store.set(SORT_KEY, sorts)
          render()
        }
        return b
      }),
    )
  }

  function row(w: KnownWorkspace, fav: boolean): HTMLElement {
    const gone = missing.has(w.path)
    const r = el('div', { class: 'ws-row' })
    r.classList.toggle('missing', gone)
    r.classList.toggle('current', hooks.current !== null && hooks.current.toLowerCase() === w.path.toLowerCase())
    const open = el(
      'button',
      { type: 'button', class: 'ws-open', title: w.path },
      el('span', { class: 'ws-name' }, w.name || host.basename(w.path)),
      // left-to-right marks around it: the right-to-left trick that cuts long paths at the start must not move the separators
      el('span', { class: 'ws-path' }, `\u200E${gone ? `${t('ws.missing')} – ${w.path}` : host.dirname(w.path)}\u200E`),
    )
    open.disabled = gone
    open.onclick = () => done(() => hooks.open(w.path))
    const when = el('span', { class: 'ws-date', title: t('ws.openedTip') }, date(w.opened))
    r.append(open, when)
    if (fav) {
      const unlink = el('button', { type: 'button', class: 'ws-act', title: t('ws.unlinkTip'), 'aria-label': t('ws.unlinkTip') }, '✕')
      unlink.onclick = async () => {
        await setFavorite(w.path, false)
        w.favorite = false
        render()
      }
      r.append(unlink)
    } else {
      const link = el('button', { type: 'button', class: 'ws-act ws-link', title: w.favorite ? t('ws.unlinkTip') : t('ws.linkTip') }, w.favorite ? `★ ${t('ws.linked')}` : `☆ ${t('ws.link')}`)
      link.classList.toggle('on', w.favorite)
      link.onclick = async () => {
        const favorite = !w.favorite
        await setFavorite(w.path, favorite)
        w.favorite = favorite
        render()
      }
      r.append(link)
      if (gone) {
        const forget = el('button', { type: 'button', class: 'ws-act', title: t('ws.forgetTip') }, t('ws.forget'))
        forget.onclick = async () => {
          await forgetWorkspace(w.path)
          list = list.filter((x) => x !== w)
          render()
        }
        r.append(forget)
      }
    }
    return r
  }

  function render() {
    sortButtons(favSort, 'fav')
    sortButtons(allSort, 'all')
    const favs = sorted(
      list.filter((w) => w.favorite),
      sorts.fav,
    )
    favList.replaceChildren(...(favs.length ? favs.map((w) => row(w, true)) : [el('div', { class: 'ws-empty' }, t('ws.noFavorites'))]))
    const all = sorted(list, sorts.all)
    allList.replaceChildren(...(all.length ? all.map((w) => row(w, false)) : [el('div', { class: 'ws-empty' }, t('ws.none'))]))
  }

  render()
  ;(box.querySelector<HTMLButtonElement>('.ws-open:not(:disabled)') ?? close).focus()
  // which files are gone (moved or deleted)
  const checks = await Promise.all(list.map((w) => host.fileHash(w.path).then((h) => h === null, () => false)))
  list.forEach((w, i) => checks[i] && missing.add(w.path))
  if (missing.size) render()
}
