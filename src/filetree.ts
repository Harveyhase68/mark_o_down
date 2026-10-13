// The folder tree beside the editor: folders and Markdown files below a chosen folder.
// Left or right, width by dragging its edge, can be hidden – all remembered, like the
// last folder. The field on top: a pasted path (file or folder) goes there, text finds
// files and folders below the current folder whose name contains it ("liz" → Lizenz.md,
// Blizzard.md). In the tree: arrow keys, Enter, and typing a name's first letters.

import * as host from './platform'
import { el, store } from './editor/dom'
import { openMenu, type MenuItem } from './editor/dialog'
import { kbd, t } from './i18n'

export interface FileTreeHooks {
  /** open a Markdown file (asks about unsaved changes) */
  open: (path: string) => void
  /** back to the text */
  focusEditor: () => void
  /** "New workspace here …" (the folder shown) */
  newWorkspace?: (folder: string) => void
  /** a file dragged over the window: true if it can be dropped there (as a link) */
  dragOver?: (x: number, y: number) => boolean
  /** … dropped there */
  drop?: (path: string, x: number, y: number) => void
  /** … the drag ended (dropped or cancelled) */
  dragEnd?: () => void
}

interface Settings {
  visible: boolean
  side: 'left' | 'right'
  width: number
  root: string | null
  /** expanded folders (absolute paths) */
  open: string[]
}

interface Item {
  path: string
  name: string
  dir: boolean
  depth: number
  open: boolean
  /** undefined: not loaded yet */
  children?: Item[]
}

interface Row {
  path: string
  name: string
  dir: boolean
  depth: number
  item?: Item
  /** search result: the folder it is in (relative), the matched part */
  where?: string
  match?: [number, number]
}

const KEY = 'mod-tree'
const MAX_OPEN = 300
const windowsPaths = /^[a-zA-Z]:[\\/]|^\\\\/
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const svg = (d: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 14),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
}

// ------------------------------------------------------------------ paths

const sepOf = (p: string) => (p.includes('\\') || windowsPaths.test(p) ? '\\' : '/')
const isRoot = (p: string) => /^[a-zA-Z]:[\\/]?$/.test(p) || p === '/' || /^\\\\[^\\]+\\[^\\]+\\?$/.test(p)
const child = (dir: string, name: string) => (/[\\/]$/.test(dir) ? dir + name : dir + sepOf(dir) + name)
const samePath = (a: string, b: string) => (windowsPaths.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b)

/** C:\a\b → C:\a, C:\a → C:\, / → null */
export function parentDir(p: string): string | null {
  if (isRoot(p)) return null
  const trimmed = p.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (i < 0) return null
  const d = trimmed.slice(0, i)
  if (/^[a-zA-Z]:$/.test(d)) return d + '\\'
  return d || '/'
}

/** The folders from `root` down to `path` (without root, with path) – null if not below root. */
export function pathBelow(root: string, path: string): string[] | null {
  const chain: string[] = []
  for (let p: string | null = path; p; p = parentDir(p)) {
    if (samePath(p, root)) return chain.reverse()
    chain.push(p)
  }
  return null
}

/** A pasted path: quotes from "Copy as path" removed, `~` = home. */
const cleanPath = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
const looksLikePath = (s: string) => host.isFileSystemAbsolute(s) || s.startsWith('/') || s === '~' || s.startsWith('~/')

// ------------------------------------------------------------------ the tree

export function createFileTree(pane: HTMLElement, resizer: HTMLElement, hooks: FileTreeHooks) {
  const saved = store.get<Partial<Settings>>(KEY, {})
  const settings: Settings = {
    visible: saved.visible ?? true,
    side: saved.side === 'right' ? 'right' : 'left',
    width: saved.width ?? 260,
    root: saved.root ?? null,
    open: saved.open ?? [],
  }
  const openSet = new Set(settings.open)
  const save = () => store.set(KEY, { ...settings, open: [...openSet].slice(-MAX_OPEN) })

  let roots: string[] = []
  let root: Item | null = null
  let rows: Row[] = []
  let sel: string | null = null
  let current: string | null = null
  /** search mode: the query and its results */
  let query = ''
  let results: Row[] | null = null
  let note: string | null = null
  let searchTimer = 0
  /** the open workspace: its folder is shown with its name */
  let workspace: { name: string; root: string } | null = null

  // ---------------------------------------------------------------- DOM

  const drive = el('select', { class: 'ft-drive' })
  const search = el('input', { class: 'ft-search', type: 'search', spellcheck: 'false' })
  const more = el('button', { type: 'button', class: 'ft-btn' })
  more.innerHTML = ICON.more
  const up = el('button', { type: 'button', class: 'ft-btn' })
  up.innerHTML = ICON.up
  const folder = el('span', { class: 'ft-folder' })
  const list = el('div', { class: 'ft-list', tabindex: '0', role: 'tree' })
  pane.replaceChildren(
    el('div', { class: 'ft-head' }, drive, search, more),
    el('div', { class: 'ft-path' }, up, folder),
    list,
  )

  function texts() {
    search.placeholder = t('tree.search')
    search.title = t('tree.searchTip')
    drive.title = t('tree.drive')
    more.title = t('tree.menu')
    up.title = `${t('tree.up')} (${t('tree.backspace')})`
    pane.setAttribute('aria-label', t('tree.title'))
  }

  // ---------------------------------------------------------------- layout

  function layout() {
    document.body.classList.toggle('show-tree', settings.visible)
    document.body.classList.toggle('tree-right', settings.side === 'right')
    pane.style.width = `${settings.width}px`
  }

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    resizer.setPointerCapture(e.pointerId)
    document.body.classList.add('tree-resizing')
    const box = pane.parentElement!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const w = settings.side === 'left' ? ev.clientX - box.left : box.right - ev.clientX
      settings.width = Math.round(Math.min(Math.max(w, 150), Math.max(200, box.width * 0.6)))
      pane.style.width = `${settings.width}px`
    }
    const stop = () => {
      resizer.removeEventListener('pointermove', move)
      document.body.classList.remove('tree-resizing')
      save()
    }
    resizer.addEventListener('pointermove', move)
    resizer.addEventListener('pointerup', stop, { once: true })
    resizer.addEventListener('lostpointercapture', stop, { once: true })
  })
  resizer.addEventListener('dblclick', () => {
    settings.width = 260
    layout()
    save()
  })

  // ---------------------------------------------------------------- loading

  async function load(item: Item) {
    let entries: host.DirEntry[] = []
    try {
      entries = await host.listDir(item.path)
    } catch {
      /* gone or no access: empty */
    }
    entries.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1))
    const old = new Map((item.children ?? []).map((c) => [c.path, c]))
    item.children = entries.map((e) => {
      const path = child(item.path, e.name)
      const before = old.get(path)
      if (before && before.dir === e.dir) return before
      return { path, name: e.name, dir: e.dir, depth: item.depth + 1, open: e.dir && openSet.has(path) }
    })
    // folders that were open: load them too (remembered from last time, or still open)
    await Promise.all(item.children.filter((c) => c.open).map((c) => load(c)))
  }

  async function setRoot(path: string | null, remember = true) {
    settings.root = path
    if (remember) save()
    root = path ? { path, name: path, dir: true, depth: -1, open: true } : null
    if (root) await load(root)
    render()
    if (results && query.trim()) onSearchInput() // searching: now in the new folder
  }

  /** Re-read the open folders (files come and go outside). */
  async function refresh() {
    if (!root) return
    const again = async (item: Item) => {
      await load(item)
      await Promise.all((item.children ?? []).filter((c) => c.open && c.children).map(again))
    }
    await again(root)
    render()
  }

  async function toggle(item: Item, open = !item.open) {
    item.open = open
    if (open) openSet.add(item.path)
    else openSet.delete(item.path)
    save()
    if (open && !item.children) await load(item)
    render()
  }

  /** Expand down to `path` and select it (if it is below the folder). */
  async function reveal(path: string, scroll = true) {
    if (!root) return false
    const chain = pathBelow(root.path, path)
    if (!chain) return false
    let item = root
    for (const p of chain) {
      if (!item.children) await load(item)
      const next = item.children!.find((c) => samePath(c.path, p))
      if (!next) break
      if (next.dir && p !== chain.at(-1) && !next.open) {
        next.open = true
        openSet.add(next.path)
      }
      item = next
    }
    save()
    sel = item.path
    render()
    if (scroll) list.querySelector('.ft-row.sel')?.scrollIntoView({ block: 'nearest' })
    return true
  }

  // ---------------------------------------------------------------- rendering

  function treeRows(): Row[] {
    const out: Row[] = []
    const walk = (items: Item[]) => {
      for (const i of items) {
        out.push({ path: i.path, name: i.name, dir: i.dir, depth: i.depth, item: i })
        if (i.dir && i.open && i.children) walk(i.children)
      }
    }
    if (root?.children) walk(root.children)
    return out
  }

  function render() {
    texts()
    const inWorkspace = !!root && !!workspace && samePath(root.path, workspace.root)
    folder.textContent = inWorkspace ? workspace!.name : root ? (isRoot(root.path) ? root.path : host.basename(root.path.replace(/[\\/]+$/, ''))) : ''
    folder.classList.toggle('workspace', inWorkspace)
    folder.title = inWorkspace ? `${t('tree.workspace')}: ${workspace!.name}\n${root!.path}` : (root?.path ?? '')
    up.disabled = !root || parentDir(root.path) === null
    renderDrives()

    rows = results ?? treeRows()
    const frag = document.createDocumentFragment()
    rows.forEach((r, i) => {
      const row = el('div', { class: 'ft-row', role: 'treeitem', 'data-i': String(i) })
      row.style.setProperty('--depth', String(results ? 0 : r.depth))
      row.classList.toggle('dir', r.dir)
      row.classList.toggle('sel', sel !== null && samePath(r.path, sel))
      row.classList.toggle('current', current !== null && samePath(r.path, current))
      if (r.dir && r.item) row.setAttribute('aria-expanded', String(r.item.open))
      const twisty = el('span', { class: 'ft-twisty' })
      if (r.dir && !results) {
        twisty.innerHTML = ICON.chevron
        twisty.classList.toggle('open', r.item!.open)
      }
      const icon = el('span', { class: 'ft-icon' })
      icon.innerHTML = r.dir ? ICON.folder : ICON.file
      const name = el('span', { class: 'ft-name' })
      if (r.match) name.append(r.name.slice(0, r.match[0]), el('mark', {}, r.name.slice(...r.match)), r.name.slice(r.match[1]))
      else name.textContent = r.name
      row.append(twisty, icon, name)
      if (r.where) row.append(el('span', { class: 'ft-where' }, r.where))
      row.title = r.dir ? r.path : `${r.path}\n${t('tree.dragTip')}`
      frag.append(row)
    })
    if (!rows.length || note) {
      const empty = el('div', { class: 'ft-note' }, note ?? (root ? t('tree.noFiles') : t('tree.empty')))
      if (!root && !results) {
        const pick = el('button', { type: 'button', class: 'ft-pick' }, t('tree.pick'))
        pick.onclick = () => void pickRoot()
        empty.append(el('br'), pick)
      }
      frag.append(empty)
    }
    list.replaceChildren(frag)
  }

  function renderDrives() {
    drive.hidden = roots.length < 2
    const value = root ? (roots.find((r) => pathBelow(r, root!.path) !== null || samePath(r, root!.path)) ?? '') : ''
    const labels = roots.map((r) => (/^[a-zA-Z]:\\$/.test(r) ? r.slice(0, 2) : r === '/' ? '/' : '~'))
    if (drive.options.length !== roots.length || [...drive.options].some((o, i) => o.value !== roots[i])) {
      drive.replaceChildren(...roots.map((r, i) => Object.assign(el('option', { value: r }, labels[i]), { title: r })))
      drive.append(el('option', { value: '', hidden: '' }, '–'))
    }
    drive.value = value
  }

  async function loadDrives() {
    roots = await host.listRoots().catch(() => [])
    renderDrives()
  }

  // ---------------------------------------------------------------- actions

  async function activate(r: Row, viaKeyboard = false) {
    sel = r.path
    if (!r.dir) {
      render()
      hooks.open(r.path)
      return
    }
    if (results) {
      // a folder found: show it in the tree
      clearSearch()
      await reveal(r.path)
      if (viaKeyboard) list.focus()
      return
    }
    await toggle(r.item!)
  }

  async function goUp() {
    const p = root && parentDir(root.path)
    if (!p) return
    const from = root!.path
    await setRoot(p)
    await reveal(from)
  }

  async function pickRoot() {
    const p = await host.pickFolder().catch(() => null)
    if (p) await setRoot(p)
  }

  /** A file or folder path typed or pasted into the field. */
  async function goTo(raw: string) {
    let path = cleanPath(raw)
    if (path === '~' || path.startsWith('~/')) path = (roots[1] ?? '/') + path.slice(1)
    const kind = await host.pathKind(path).catch(() => null)
    if (!kind) {
      note = t('tree.notFound', { path })
      results = []
      return render()
    }
    clearSearch()
    if (kind === 'dir') {
      await setRoot(path.replace(/(?<=.)[\\/]+$/, '') || path)
      list.focus()
      return
    }
    const dir = parentDir(path)
    if (dir && (!root || !pathBelow(root.path, path))) await setRoot(dir)
    await reveal(path)
    if (host.isMarkdownFile(path)) hooks.open(path)
  }

  function clearSearch() {
    search.value = query = ''
    results = null
    note = null
    clearTimeout(searchTimer)
    render()
  }

  function onSearchInput() {
    query = search.value
    clearTimeout(searchTimer)
    const q = query.trim()
    if (!q) return clearSearch()
    if (looksLikePath(cleanPath(q))) {
      results = []
      note = t('tree.pathHint')
      return render()
    }
    if (!root) {
      results = []
      note = t('tree.empty')
      return render()
    }
    searchTimer = window.setTimeout(async () => {
      note = t('tree.searching')
      results ??= []
      render()
      const base = root!.path
      const r = await host.findFiles(base, q).catch(() => null)
      if (r?.cancelled || search.value !== query || !root || root.path !== base) return
      const needle = q.replace(/\\/g, '/').toLowerCase()
      // near ones first, then folders, then by name as in the tree (Kapitel2 before Kapitel10)
      const depth = (p: string) => p.split('/').length
      const found = (r?.found ?? []).sort(
        (a, b) => depth(a.path) - depth(b.path) || Number(b.dir) - Number(a.dir) || collator.compare(a.path, b.path),
      )
      results = found.map((f) => {
        const slash = f.path.lastIndexOf('/')
        const name = f.path.slice(slash + 1)
        const at = name.toLowerCase().indexOf(needle.slice(needle.lastIndexOf('/') + 1))
        return {
          path: host.joinPath(base, f.path),
          name,
          dir: f.dir,
          depth: 0,
          where: slash < 0 ? '' : f.path.slice(0, slash),
          match: at < 0 ? undefined : ([at, at + needle.length - needle.lastIndexOf('/') - 1] as [number, number]),
        }
      })
      note = results.length ? null : t('tree.noMatch', { query: q })
      if (r?.more) results.push({ path: '', name: t('tree.more'), dir: false, depth: 0 })
      sel = results[0]?.path ?? null
      render()
    }, 150)
  }

  search.addEventListener('input', onSearchInput)
  // a pasted path: go there right away (it replaces what was in the field)
  search.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!looksLikePath(cleanPath(text)) || /[\r\n]/.test(text.trim())) return
    e.preventDefault()
    search.value = cleanPath(text)
    void goTo(text)
  })
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (search.value) clearSearch()
      else hooks.focusEditor()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const q = search.value.trim()
      if (looksLikePath(cleanPath(q))) void goTo(q)
      else {
        const r = rows.find((x) => x.path && sel && samePath(x.path, sel)) ?? rows.find((x) => x.path)
        if (r) void activate(r, true)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      list.focus()
      if (!sel && rows[0]) move(0, true)
    }
  })

  more.onclick = () => openMenu(more, menuItems())
  up.onclick = () => void goUp()
  drive.onpointerdown = () => void loadDrives() // a USB stick may have come
  drive.onchange = () => {
    if (drive.value) void setRoot(drive.value)
  }

  function menuItems(): MenuItem[] {
    const doc = current
    return [
      { label: t('tree.pick'), run: () => void pickRoot() },
      ...(workspace ? [{ label: t('tree.wsRoot', { name: workspace.name }), run: () => void setRoot(workspace!.root) }] : []),
      { label: t('tree.docFolder'), disabled: !doc, run: () => doc && void setRoot(parentDir(doc)).then(() => reveal(doc)) },
      { label: t('tree.refresh'), shortcut: 'F5', disabled: !root, run: () => void refresh() },
      'separator',
      ...(hooks.newWorkspace ? [{ label: t('tree.newWorkspace'), disabled: !root, run: () => root && hooks.newWorkspace!(root.path) }, 'separator' as const] : []),
      { label: `${settings.side === 'left' ? '✓' : ' '}  ${t('tree.left')}`, run: () => setSide('left') },
      { label: `${settings.side === 'right' ? '✓' : ' '}  ${t('tree.right')}`, run: () => setSide('right') },
      { label: `   ${t('tree.hide')}`, shortcut: kbd('Ctrl+Shift+B'), run: () => setVisible(false) },
    ]
  }

  function rowMenu(r: Row): MenuItem[] {
    const items: MenuItem[] = [
      r.dir ? { label: t('tree.makeRoot'), run: () => void setRoot(r.path) } : { label: t('tree.open'), run: () => hooks.open(r.path) },
      { label: t('tree.reveal'), run: () => void host.revealFile(r.path).catch(() => {}) },
    ]
    if (results) items.push({ label: t('tree.showInTree'), run: () => (clearSearch(), void reveal(r.path)) })
    return items
  }

  function setSide(side: 'left' | 'right') {
    settings.side = side
    layout()
    save()
  }

  function setVisible(visible: boolean) {
    settings.visible = visible
    layout()
    save()
    if (visible) {
      if (!root && current) void setRoot(parentDir(current)).then(() => reveal(current!))
      else if (current) void reveal(current)
      search.focus()
    } else hooks.focusEditor()
  }

  // ---------------------------------------------------------------- mouse

  const rowAt = (e: Event) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ft-row')
    return row ? { el: row, row: rows[+row.dataset.i!] } : null
  }
  // dragging a file into the document makes a link to it. With the pointer, not HTML5
  // drag & drop: the window's native drop handling (files from Explorer) takes that.
  let drag: { path: string; x: number; y: number; id: number; ghost: HTMLElement | null; droppable: boolean } | null = null
  /** a drag just ended: the click that follows is not a click */
  let dragged = false
  list.addEventListener('pointerdown', (e) => {
    const hit = rowAt(e)
    if (e.button !== 0 || !hit?.row.path || hit.row.dir || !hooks.drop) return
    drag = { path: hit.row.path, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, droppable: false }
  })
  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
      list.setPointerCapture(e.pointerId)
      drag.ghost = el('div', { class: 'ft-ghost' }, host.basename(drag.path))
      document.body.append(drag.ghost)
      document.body.classList.add('ft-dragging')
    }
    drag.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`
    drag.droppable = hooks.dragOver?.(e.clientX, e.clientY) ?? false
    drag.ghost.classList.toggle('no-drop', !drag.droppable)
  })
  const endDrag = (e: PointerEvent | null, drop: boolean) => {
    const d = drag
    drag = null
    if (!d?.ghost) return
    dragged = true
    setTimeout(() => (dragged = false))
    d.ghost.remove()
    document.body.classList.remove('ft-dragging')
    if (list.hasPointerCapture(d.id)) list.releasePointerCapture(d.id)
    if (drop && e && hooks.dragOver?.(e.clientX, e.clientY)) hooks.drop!(d.path, e.clientX, e.clientY)
    hooks.dragEnd?.()
  }
  list.addEventListener('pointerup', (e) => endDrag(e, true))
  list.addEventListener('pointercancel', () => endDrag(null, false))
  window.addEventListener('keydown', (e) => drag?.ghost && e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), endDrag(null, false)), true)

  list.addEventListener('click', (e) => {
    const hit = rowAt(e)
    if (dragged || !hit?.row.path) return
    // double-click on a folder: show its contents as the tree (Explorer-like); ↑ goes back.
    // (counted here: the first click redraws the rows, so there is no dblclick event)
    if (e.detail === 2 && hit.row.dir && !results) return void setRoot(hit.row.path)
    if (e.detail <= 1) void activate(hit.row)
  })
  list.addEventListener('contextmenu', (e) => {
    const hit = rowAt(e)
    if (!hit?.row.path) return
    e.preventDefault()
    sel = hit.row.path
    render()
    const anchor = list.querySelector<HTMLElement>('.ft-row.sel') ?? hit.el
    openMenu(anchor, rowMenu(hit.row))
  })

  // ---------------------------------------------------------------- keyboard

  function move(index: number, scroll = true) {
    const real = rows.filter((r) => r.path)
    if (!real.length) return
    const r = real[Math.min(Math.max(index, 0), real.length - 1)]
    sel = r.path
    render()
    if (scroll) list.querySelector('.ft-row.sel')?.scrollIntoView({ block: 'nearest' })
  }

  let typed = ''
  let typedAt = 0
  /** Type-ahead: the next name starting with the letters typed (one letter again: the next one). */
  function typeAhead(ch: string) {
    const now = Date.now()
    typed = now - typedAt > 800 ? ch : typed + ch
    typedAt = now
    const real = rows.filter((r) => r.path)
    const at = real.findIndex((r) => sel !== null && samePath(r.path, sel))
    const same = [...typed].every((c) => c === typed[0])
    const prefix = same && typed.length > 1 ? typed[0] : typed
    const start = same || at < 0 ? at + 1 : at
    for (let k = 0; k < real.length; k++) {
      const i = (start + k) % real.length
      if (real[i].name.toLowerCase().startsWith(prefix.toLowerCase())) return move(i)
    }
  }

  list.addEventListener('keydown', (e) => {
    const real = rows.filter((r) => r.path)
    const at = real.findIndex((r) => sel !== null && samePath(r.path, sel))
    const r = real[at]
    const page = Math.max(1, Math.floor(list.clientHeight / 24) - 1)
    const key = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    switch (e.key) {
      case 'ArrowDown':
        return key(() => move(at + 1))
      case 'ArrowUp':
        return key(() => (at <= 0 ? search.focus() : move(at - 1)))
      case 'PageDown':
        return key(() => move(at + page))
      case 'PageUp':
        return key(() => move(Math.max(at - page, 0)))
      case 'Home':
        return key(() => move(0))
      case 'End':
        return key(() => move(real.length - 1))
      case 'ArrowRight':
        return key(() => {
          if (!r?.item?.dir) return
          if (!r.item.open) void toggle(r.item, true)
          else if (r.item.children?.length) move(at + 1)
        })
      case 'ArrowLeft':
        return key(() => {
          if (!r?.item) return
          if (r.item.dir && r.item.open) return void toggle(r.item, false)
          const p = parentDir(r.path)
          if (p && root && !samePath(p, root.path)) {
            sel = p
            render()
            list.querySelector('.ft-row.sel')?.scrollIntoView({ block: 'nearest' })
          }
        })
      case 'Enter':
        return key(() => r && void activate(r, true))
      case 'Backspace':
        return key(() => void goUp())
      case 'F5':
        return key(() => void refresh())
      case 'Escape':
        return key(() => (results ? (clearSearch(), search.focus()) : hooks.focusEditor()))
    }
    if (e.key.length === 1 && e.key !== ' ') key(() => typeAhead(e.key))
  })

  // files come and go while the window is in the background
  window.addEventListener('focus', () => {
    if (settings.visible) void refresh()
  })

  // ---------------------------------------------------------------- start

  layout()
  render()
  void loadDrives()
  const ready = settings.root ? setRoot(settings.root, false) : Promise.resolve()

  return {
    /** the open document changed (also after "Save as"): mark it, show it in the tree */
    async setCurrent(path: string | null) {
      if (path === current) return
      current = path
      await ready
      if (!path) return render()
      // no folder yet: the document's folder
      if (!root) return void (await setRoot(parentDir(path)), await reveal(path))
      if (!pathBelow(root.path, path)) return render()
      await refresh() // "Save as" may have made a new file
      await reveal(path)
    },
    visible: () => settings.visible,
    /** Show a file in the tree (the tree appears; its folder becomes the top if it is not below it). */
    async show(path: string) {
      if (!settings.visible) setVisible(true)
      if (!root || !pathBelow(root.path, path)) await setRoot(parentDir(path))
      await reveal(path)
      list.focus()
    },
    /** the folder shown */
    root: () => root?.path ?? null,
    /** a workspace was opened (its folder becomes the tree) or closed (null) */
    async setWorkspace(ws: { name: string; root: string } | null) {
      await ready
      workspace = ws
      if (ws && (!root || !samePath(root.path, ws.root))) {
        await setRoot(ws.root)
        if (current) await reveal(current)
      } else render()
    },
    toggle: () => setVisible(!settings.visible),
    /** the language changed */
    relabel: () => render(),
  }
}
