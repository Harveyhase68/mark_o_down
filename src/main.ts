import './style.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { importMarkdown, exportMarkdown, NEW_DOC_META, type DocMeta } from './md/document'
import { applyFix, lintHtml } from './md/htmlLint'
import { findAnchor, parseLinkTarget } from './md/anchors'
import { documentTitle, renderHtml, renderHtmlPage } from './md/html'
import { createEditor, editImage, editLink, insertEmoji, type EditorHooks } from './editor/editor'
import { createToolbar } from './editor/toolbar'
import { askChoice, askSaveChanges, openMenu, type MenuItem } from './editor/dialog'
import { addRecent, clearRecent, recentFiles, removeRecent, shortDir } from './recent'
import { htmlToMarkdown } from './md/htmlImport'
import { HELP_URL, showAbout } from './editor/about'
import { printMarkdown } from './editor/print'
import { createFindBar } from './editor/findbar'
import { modalOpen } from './editor/modal'
import { renderOptions } from './md/renderOptions'
import { setupZoom } from './editor/zoom'
import { imageExtension, pastedImageStem } from './editor/paste'
import * as host from './platform'
import { createGuard, sessionEnabled, setSessionEnabled } from './guard'
import { languageName, refreshSpell, setSpellEnabled, showLanguageMenu, spellEnabled, spellLanguage } from './editor/spell'
import { extendedSyntaxOn, setExtendedSyntax, setWikiLinks, wikiLinksOn } from './md/markdown'
import { findByName, isWorkspaceFile, readWorkspace, relativePath, rememberWorkspace, writeWorkspace, WORKSPACE_VERSION, type Workspace } from './workspace'
import { openWorkspaceWindow, safeFileName, workspaceForm } from './workspaceUi'
import { WIKI_INDEX_EVENT } from './editor/wikilinks'
import { createDropCaret, dropPosition, fileLink, insertFileLink } from './editor/filedrop'
import { store } from './editor/dom'
import { createFileTree } from './filetree'

// the Markdown dialect: extended syntax (Pandoc/Obsidian) on by default
const EXTENDED_KEY = 'mod-extended'
setExtendedSyntax(store.get<boolean>(EXTENDED_KEY, true))
import { Selection, TextSelection, type EditorState } from 'prosemirror-state'
import { createTabBar, type TabInfo } from './tabs'
import { getLang, kbd, onLangChange, t, type MessageKey } from './i18n'

// ------------------------------------------------------------------ state

interface DocState {
  path: string | null
  /** Base for `/…` image paths (Git repo root or the document folder). */
  root: string | null
  eol: host.Eol
  bom: boolean
  mixedEol: boolean
  meta: DocMeta
  /** Document as last loaded/saved, for the "modified" indicator (null: restored, never saved). */
  saved: PMNode | null
  /** Hash of the file on disk as loaded/saved – detects changes by other programs. */
  diskHash: string | null
  /** Unsaved document created from a file (HTML import): where "Save" proposes to write. */
  suggested: string | null
}

/** What we know about the file behind a document. */
interface FileInfo {
  path: string | null
  root?: string | null
  eol?: host.Eol
  bom?: boolean
  mixedEol?: boolean
  hash?: string | null
  suggested?: string | null
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const editorEl = $('#editor')
const sourceEl = $<HTMLTextAreaElement>('#source')
const statusEl = $('#status')

/** The document in front (= active.doc). */
let doc!: DocState
let sourceVisible = false
let elevatedWarning = false
let flashMessage: string | null = null
/** the folder tree (only in the app) */
let fileTree: ReturnType<typeof createFileTree> | null = null

const hooks: EditorHooks = {
  // an imported (unsaved) document resolves images from where it came from
  docPath: () => doc?.path ?? doc?.suggested ?? null,
  resolveImage: (src) => host.resolveImage(src, doc?.path ?? doc?.suggested ?? null, doc?.root ?? null),
  pickImage: host.isTauri
    ? async () => {
        const file = await host.pickImagePath()
        return file ? host.relativeImagePath(file, doc.path) : null
      }
    : undefined,
  followLink: (href, at, wiki) => void followLink(href, at, wiki),
  findWiki: (target) => findWiki(target),
  pasteImage: (v, image) => void pasteImage(v, image),
  onChange: () => {
    scheduleUpdate()
    guard.onChange()
    findBar?.update()
  },
}

/** A save/close question is open: background checks must not interrupt it. */
let busy = false

const guard = createGuard({
  doc: () => doc,
  isDirty: () => isDirty(),
  anyDirty: () => tabs.some(tabDirty),
  tabs: () => ({ tabs: tabs.map(tabRecovery), active: tabs.indexOf(active) }),
  reload: () => reloadFromDisk(),
  restore: (data) => restoreTab(data),
  activate: (id) => {
    const tab = tabs.find((x) => x.id === id)
    if (tab) activate(tab)
  },
  busy: () => busy,
  flash: (m) => flash(m),
  markChanged: () => {
    doc.saved = null
    updateChrome()
  },
})

const editor = createEditor(editorEl, hooks)
const view = editor.view
if (host.isTauri) fileTree = createFileTree($('#filetree'), $('#tree-resizer'), {
    open: (p) => void openFromTree(p),
    focusEditor: () => view.focus(),
    newWorkspace: (folder) => void newWorkspace(folder),
    dragOver: (x, y) => fileDragOver(x, y),
    drop: (path, x, y) => fileDrop(path, x, y),
    dragEnd: () => dropCaret.hide(),
  })
let toolbar = createToolbar($('#toolbar'), view, toolbarActions())

function toolbarActions(): Parameters<typeof createToolbar>[2] {
  return {
  open: () => void openFile(),
  openMenu: () => openMenuItems(),
  save: () => void saveFile(false),
  saveAs: () => void saveFile(true),
  close: () => void closeDocument(),
  print: () => void printDocument(),
  exportHtml: () => void exportHtml(),
  exportPdf: () => void exportPdf(),
  copyHtml: () => void copyHtml(),
  help: () => void host.openExternal(HELP_URL),
  about: () => void showAbout(),
  link: (v) => void editLink(v),
  image: (v) => void editImage(v, hooks),
  emoji: (v) => void insertEmoji(v),
  find: () => findBar.open(false),
  toggleSource,
  sourceVisible: () => sourceVisible,
  tree: fileTree ? { visible: () => fileTree!.visible(), toggle: () => fileTree!.toggle() } : undefined,
  session: host.isTauri ? { enabled: sessionEnabled, toggle: () => setSessionEnabled(!sessionEnabled()) } : undefined,
  extended: { enabled: extendedSyntaxOn, toggle: () => switchExtendedSyntax(!extendedSyntaxOn()) },
  spell: {
    enabled: spellEnabled,
    toggle: () => {
      setSpellEnabled(!spellEnabled())
      refreshSpell(view)
    },
    language: () => {
      const tag = spellLanguage()
      return tag ? languageName(tag) : t('spell.none')
    },
    chooseLanguage: (anchor) => void showLanguageMenu(view, anchor),
  },
  }
}
const findBar = createFindBar($('#workspace'), view)
// Ctrl+wheel, Ctrl+Plus/Minus/0 and the "− 100 % +" control in the status bar
const zoom = setupZoom(editorEl, $('#scroller'), $('#zoom'))

// ------------------------------------------------------------------ UI updates

const isDirty = () => doc.saved === null || !view.state.doc.eq(doc.saved)
/** The document as Markdown (source edits not applied yet are applied first). */
const markdown = () => {
  applySource()
  return exportMarkdown(view.state.doc, doc.meta)
}
const docName = () => host.basename(doc.path ?? doc.suggested ?? t('doc.untitled'))
const withoutExt = (name: string) => name.replace(/\.[^.\\/]+$/, '')

let updateQueued = false
function scheduleUpdate() {
  toolbar.update()
  if (updateQueued) return
  updateQueued = true
  requestAnimationFrame(() => {
    updateQueued = false
    updateChrome()
  })
}

let lastTitle = ''
function updateChrome() {
  const title = `${isDirty() ? '● ' : ''}${docName()}${workspace ? ` — ${workspace.data.name}` : ''} — Mark O Down`
  void fileTree?.setCurrent(doc.path)
  tabBar.render(tabInfos())
  if (title !== lastTitle) void host.setWindowTitle((lastTitle = title))

  const text = view.state.doc.textContent
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const parts = [
    doc.path ?? (doc.suggested ? t('doc.newFrom', { path: doc.suggested }) : t('doc.new')),
    t('status.words', { n: words }),
    doc.eol.toUpperCase(),
    doc.bom ? t('status.bom') : 'UTF-8',
  ]
  if (doc.mixedEol) parts.push(t('status.mixedEol'))
  if (elevatedWarning) parts.unshift(t('status.elevated'))
  // Opened in a plain browser (e.g. the dev server URL): no real file access
  if (!host.isTauri) parts.unshift(t('status.browser'))
  if (flashMessage) parts.unshift(flashMessage)
  statusEl.textContent = parts.join('   ·   ')

  if (sourceVisible && !applyingSource) showSource()
}

// ------------------------------------------------------------------ source editor (split view)
//
// The Markdown source next to the visual editor can be edited too. Whichever side is
// typed in leads: typing in the source dims (locks) the visual editor; a short pause –
// or any click/focus outside the source – applies the source to it first. Undo works
// per side: source edits enter the visual editor outside its undo history.

let sourcePending = false
let applyingSource = false
let sourceTimer = 0
let lintTimer = 0

/** Visual editor → source (keeps the source's cursor and scroll position when possible). */
function showSource() {
  const md = exportMarkdown(view.state.doc, doc.meta)
  if (sourceEl.value === md) return
  const { selectionStart, selectionEnd, scrollTop } = sourceEl
  sourceEl.value = md
  sourceEl.setSelectionRange(Math.min(selectionStart, md.length), Math.min(selectionEnd, md.length))
  sourceEl.scrollTop = scrollTop
  scheduleLint()
}

sourceEl.addEventListener('input', () => {
  sourcePending = true
  document.body.classList.add('source-pending')
  clearTimeout(sourceTimer)
  sourceTimer = window.setTimeout(applySource, 400)
})

/** Source → visual editor: only the blocks that differ are replaced. */
function applySource() {
  clearTimeout(sourceTimer)
  if (!sourcePending) return
  sourcePending = false
  document.body.classList.remove('source-pending')
  const { doc: next, meta } = importMarkdown(sourceEl.value)
  doc.meta = meta
  const cur = view.state.doc
  let start = 0
  while (start < cur.childCount && start < next.childCount && cur.child(start).eq(next.child(start))) start++
  let endCur = cur.childCount
  let endNext = next.childCount
  while (endCur > start && endNext > start && cur.child(endCur - 1).eq(next.child(endNext - 1))) {
    endCur--
    endNext--
  }
  const pos = (n: PMNode, i: number) => {
    let p = 0
    for (let k = 0; k < i; k++) p += n.child(k).nodeSize
    return p
  }
  if (start === endCur && start === endNext) return scheduleLint() // same document (e.g. only the gap after the last block)
  const replacement: PMNode[] = []
  for (let k = start; k < endNext; k++) replacement.push(next.child(k))
  const tr = view.state.tr.replaceWith(pos(cur, start), pos(cur, endCur), replacement)
  applyingSource = true
  try {
    view.dispatch(tr.setMeta('addToHistory', false))
  } finally {
    applyingSource = false
  }
  scheduleLint()
}

// ------------------------------------------------------------------ following links
//
// Ctrl+click: `#anchor` jumps to the heading, `other.md#anchor` opens it in Mark O Down
// (and jumps), web addresses go to the browser. Another local file is only shown in
// Explorer – a link in a document must never start a program. Alt+←/→ (or the mouse's
// side buttons) go back and forth, like a browser.

interface Place {
  path: string | null
  pos: number
  scroll: number
}
const history = { back: [] as Place[], forward: [] as Place[] }
/** Where we are; `at`: the clicked link (Ctrl+click does not move the cursor there) */
const here = (at?: number): Place => ({ path: doc.path, pos: at ?? view.state.selection.head, scroll: $('#scroller').scrollTop })
const windowsPaths = /Windows/.test(navigator.userAgent)
const samePath = (a: string | null, b: string | null) => a !== null && b !== null && (windowsPaths ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Remember where we are before a jump (a new jump forgets the "forward" places). */
function remember(at?: number) {
  history.back.push(here(at))
  history.forward.length = 0
}

async function followLink(href: string, at?: number, wiki = false) {
  const target = parseLinkTarget(href)
  if (!target) return
  if (target.kind === 'external') return void host.openExternal(target.url)
  if (target.kind === 'anchor') return jumpToAnchor(target.fragment, true, at)
  // [[Link]] that is not next to the document: found by name in the workspace
  const byName = wiki ? findWiki(target.path) : null
  if (!doc.path && !host.isFileSystemAbsolute(target.path) && !byName) return flash(t('link.needsSave'))
  // like images: relative to the document, `/…` to the repository root (GitHub)
  let path = host.isFileSystemAbsolute(target.path)
    ? target.path
    : doc.path
      ? host.joinPath(target.path.startsWith('/') && doc.root ? doc.root : host.dirname(doc.path), target.path)
      : byName!
  if (byName && !samePath(path, byName) && (await host.fileHash(path).catch(() => null)) === null) path = byName
  if (samePath(path, doc.path)) return target.fragment ? jumpToAnchor(target.fragment, true, at) : undefined
  // a broken link: a note in the status bar (not a dialog – it is just a link)
  if ((await host.fileHash(path).catch(() => null)) === null) return flash(t('link.notFound', { name: target.path }), true)
  if (!host.isMarkdownFile(path)) {
    await host.revealFile(path).catch(() => {})
    return flash(t('link.revealed', { name: host.basename(path) }))
  }
  const from = here(at)
  await openPath(path) // in its own tab
  if (!samePath(doc.path, path)) return // could not be opened (the error was shown)
  history.back.push(from)
  history.forward.length = 0
  if (target.fragment) jumpToAnchor(target.fragment, false)
}

// a file dragged from the folder tree into the document: a link to it where it is dropped
const dropCaret = createDropCaret(view)

function fileDragOver(x: number, y: number): boolean {
  const pos = dropPosition(view, x, y)
  if (pos === null) {
    dropCaret.hide()
    return false
  }
  // near the top or bottom edge: scroll
  const scroller = $('#scroller')
  const box = scroller.getBoundingClientRect()
  if (y < box.top + 40) scroller.scrollTop -= 16
  else if (y > box.bottom - 40) scroller.scrollTop += 16
  dropCaret.show(pos)
  return true
}

function fileDrop(path: string, x: number, y: number) {
  const pos = dropPosition(view, x, y)
  if (pos === null) return
  const link = fileLink(path, doc.path, !!workspace)
  if (!link) return flash(t('drop.needsSave'), true)
  insertFileLink(view, pos, link)
}

/** A file clicked in the folder tree (Alt+← comes back, like after a link). */
async function openFromTree(path: string) {
  if (samePath(path, doc.path)) return view.focus()
  const from = here()
  await openPath(path)
  if (!samePath(doc.path, path)) return
  history.back.push(from)
  history.forward.length = 0
  view.focus()
}

/** Put the heading (or HTML anchor) at the top of the window and mark it briefly. */
function jumpToAnchor(fragment: string, record: boolean, at?: number) {
  const anchor = findAnchor(view.state.doc, fragment)
  if (!anchor) return flash(t('link.anchorNotFound', { anchor: fragment }))
  if (record) remember(at)
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(anchor.pos + 1))))
  const scroller = $('#scroller')
  const top = view.coordsAtPos(anchor.pos + 1).top - scroller.getBoundingClientRect().top
  scroller.scrollTop += top - 24
  const el = view.nodeDOM(anchor.pos)
  const block = el instanceof HTMLElement ? el : (el?.parentElement ?? null)
  if (block) {
    block.classList.remove('jump-target')
    void block.offsetWidth // restart the animation
    block.classList.add('jump-target')
    setTimeout(() => block.classList.remove('jump-target'), 1600)
  }
  view.focus()
}

/** Alt+← / Alt+→: to the place before (after) the last jump, also into another file. */
async function travel(direction: 'back' | 'forward') {
  const [from, to] = direction === 'back' ? [history.back, history.forward] : [history.forward, history.back]
  const place = from.pop()
  if (!place) return
  const current = here()
  if (place.path && !samePath(place.path, doc.path)) {
    await openPath(place.path) // its tab, or a new one
    if (!samePath(doc.path, place.path)) return // gone meanwhile
  }
  to.push(current)
  restorePosition(place.pos, place.scroll)
  view.focus()
}

// the mouse's back / forward buttons
window.addEventListener('mouseup', (e) => {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault()
    void travel(e.button === 3 ? 'back' : 'forward')
  }
})

// ------------------------------------------------------------------ keeping the cursor
//
// A click on the page margin (outside the editable area) puts the cursor at the nearest
// place. The editor keeps the focus when the window is maximized / restored / activated
// again (WebView2 may drop it while resizing), unless the user was somewhere else.

editorEl.addEventListener('mousedown', (e) => {
  if (view.dom.contains(e.target as Node) || e.button !== 0) return
  e.preventDefault()
  const box = view.dom.getBoundingClientRect()
  const left = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1)
  const top = Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1)
  const pos = view.posAtCoords({ left, top })?.pos ?? view.state.doc.content.size
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))))
  view.focus()
})

/** Where the keyboard was last: the editor, the source, or somewhere else (find bar, dialog …). */
let lastFocus: 'editor' | 'source' | 'other' = 'editor'
document.addEventListener('focusin', (e) => {
  lastFocus = view.dom.contains(e.target as Node) ? 'editor' : e.target === sourceEl ? 'source' : 'other'
})

/** Give the editor its focus back if it had it (not over a dialog, not in the source). */
function refocusEditor() {
  if (lastFocus !== 'editor' || modalOpen() || view.hasFocus()) return
  view.focus()
}
window.addEventListener('focus', () => requestAnimationFrame(refocusEditor))
window.addEventListener('resize', () => requestAnimationFrame(refocusEditor))

// leaving the source (click, focus elsewhere, a shortcut): apply it before anything else happens
document.addEventListener('pointerdown', (e) => sourcePending && !sourceEl.contains(e.target as Node) && applySource(), true)
document.addEventListener('focusin', (e) => sourcePending && e.target !== sourceEl && applySource(), true)

function scheduleLint() {
  clearTimeout(lintTimer)
  lintTimer = window.setTimeout(showLint, 300)
}

const LINT_MAX = 4

/** Problems with HTML tags in the source, each with its fix. */
function showLint() {
  const box = $('#source-lint')
  const issues = sourceVisible ? lintHtml(sourceEl.value) : []
  box.hidden = !issues.length
  box.replaceChildren()
  for (const issue of issues.slice(0, LINT_MAX)) {
    const row = document.createElement('div')
    row.className = 'lint-row'
    const msg = document.createElement('button')
    msg.type = 'button'
    msg.className = 'lint-msg'
    msg.textContent = `⚠ ${t(issue.kind === 'comment' ? 'lint.comment' : issue.kind === 'stray' ? 'lint.stray' : 'lint.unclosed', { tag: `<${issue.kind === 'stray' ? '/' : ''}${issue.tag.replace(/^<!--$/, '!--')}>`, line: issue.line })}`
    msg.title = t('lint.goto')
    msg.onclick = () => {
      sourceEl.focus()
      sourceEl.setSelectionRange(issue.offset, issue.offset)
    }
    row.append(msg)
    if (issue.fix) {
      const fix = document.createElement('button')
      fix.type = 'button'
      fix.className = 'lint-fix'
      fix.textContent = t('remove' in issue.fix ? 'lint.remove' : 'lint.close')
      fix.onclick = () => {
        const change = applyFix(sourceEl.value, issue)
        // through the editing commands, so Ctrl+Z in the source undoes it
        sourceEl.focus()
        sourceEl.setSelectionRange(change.from, change.to)
        if (!document.execCommand('insertText', false, change.insert)) {
          sourceEl.value = change.text
          sourceEl.dispatchEvent(new Event('input'))
        }
      }
      row.append(fix)
    }
    box.append(row)
  }
  if (issues.length > LINT_MAX) {
    const more = document.createElement('div')
    more.className = 'lint-more'
    more.textContent = t('lint.more', { n: issues.length - LINT_MAX })
    box.append(more)
  }
}

/**
 * Extended syntax on/off: the open document is read again in the other dialect
 * (its text stays the same; unsaved changes stay unsaved). Undo history starts anew.
 */
function switchExtendedSyntax(on: boolean) {
  reparse(() => {
    setExtendedSyntax(on)
    store.set(EXTENDED_KEY, on)
  })
}

/** The dialect changes (`change`): the open document is read again in the new one. */
function reparse(change: () => void) {
  const md = markdown() // still in the current dialect
  const dirty = isDirty()
  const cursor = view.state.selection.head
  const scroll = $('#scroller').scrollTop
  // the tabs in the background too (their undo history starts anew as well)
  const others = tabs.filter((x) => x !== active).map((tab) => ({ tab, md: exportMarkdown(tab.state!.doc, tab.doc.meta), dirty: tabDirty(tab) }))
  change()
  for (const { tab, md, dirty } of others) {
    const { doc: pm, meta } = importMarkdown(md)
    const head = tab.state!.selection.head
    tab.doc.meta = meta
    tab.state = editor.createState(pm)
    tab.state = tab.state.apply(tab.state.tr.setSelection(TextSelection.near(pm.resolve(Math.min(head, pm.content.size)))))
    tab.doc.saved = dirty ? null : tab.state.doc
  }
  setDocument(md, { path: doc.path, eol: doc.eol, bom: doc.bom, mixedEol: doc.mixedEol, hash: doc.diskHash, root: doc.root, suggested: doc.suggested })
  if (dirty) doc.saved = null
  restorePosition(cursor, scroll)
  toolbar = createToolbar($('#toolbar'), view, toolbarActions())
  updateChrome()
}

/** Put the cursor and the scroll position back (a restored session). */
function restorePosition(cursor?: number, scroll?: number) {
  if (cursor !== undefined) {
    const at = Math.max(0, Math.min(cursor, view.state.doc.content.size))
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at))).setMeta('addToHistory', false))
  }
  if (scroll !== undefined) requestAnimationFrame(() => ($('#scroller').scrollTop = scroll))
}

/** Short confirmation in the status bar. */
let flashTimer = 0
/** A short message in the status bar; `warning`: something did not work. */
function flash(message: string, warning = false) {
  flashMessage = `${warning ? '⚠' : '✓'} ${message}`
  updateChrome()
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashMessage = null
    updateChrome()
  }, 4000)
}

function toggleSource() {
  applySource()
  sourceVisible = !sourceVisible
  document.body.classList.toggle('show-source', sourceVisible)
  updateChrome()
  toolbar.update()
}

// ------------------------------------------------------------------ tabs
//
// One tab per open document. The editor shows the one in front; the others keep their
// editor state (undo history, selection) and scroll position until they come back.
// Opening a file that is open already brings its tab to the front; a new, empty tab
// that was never touched is used for the next file instead of a new one.

interface Tab {
  id: number
  doc: DocState
  /** its editor state while it is in the background (in front: the view's) */
  state: EditorState | null
  scroll: number
}

const blankDoc = (): DocState => ({ path: null, root: null, eol: 'lf', bom: false, mixedEol: false, meta: NEW_DOC_META, saved: null, diskHash: null, suggested: null })
let nextTabId = 1
let active: Tab = { id: nextTabId++, doc: blankDoc(), state: null, scroll: 0 }
let tabs: Tab[] = [active]
/** paths of closed tabs, for Ctrl+Shift+T */
const closedTabs: string[] = []

const tabState = (tab: Tab) => (tab === active ? view.state : tab.state!)
const tabDirty = (tab: Tab) => tab.doc.saved === null || !tabState(tab).doc.eq(tab.doc.saved)
/** a new document nobody typed in: the next opened file goes there */
const pristine = (tab: Tab) => !tab.doc.path && !tab.doc.suggested && !tabDirty(tab)
const tabName = (tab: Tab) => host.basename(tab.doc.path ?? tab.doc.suggested ?? t('doc.untitled'))

/** Bring `tab` to the front. */
function activate(tab: Tab) {
  if (tab === active || !tabs.includes(tab)) return
  applySource() // source edits belong to the tab they were made in
  active.state = view.state
  active.scroll = $('#scroller').scrollTop
  active = tab
  doc = tab.doc // before the state: node views resolve images from the document's folder
  editor.setState(tab.state!)
  tab.state = null
  const scroll = tab.scroll
  $('#scroller').scrollTop = scroll
  requestAnimationFrame(() => ($('#scroller').scrollTop = scroll)) // images may still grow the page
  if (sourceVisible) showSource()
  lastTitle = ''
  updateChrome()
  toolbar.update()
  void guard.checkDisk() // changed outside while it was in the background?
}

/** A new, empty tab right of the one in front. */
function newTab(): Tab {
  const tab: Tab = { id: nextTabId++, doc: blankDoc(), state: null, scroll: 0 }
  tab.state = editor.createState(view.state.schema.nodes.doc.create(null, view.state.schema.nodes.paragraph.create()))
  tab.doc.saved = tab.state.doc
  tabs.splice(tabs.indexOf(active) + 1, 0, tab)
  activate(tab)
  return tab
}

/** A file is about to be loaded: into the empty tab in front, else into a new one. */
function tabForNewDocument() {
  if (!pristine(active)) newTab()
}

/** Close a tab (asks about unsaved changes); false if the user cancelled. */
async function closeTab(tab: Tab): Promise<boolean> {
  if (tabDirty(tab)) {
    activate(tab)
    if (!(await confirmDiscard())) return false
  }
  if (tab.doc.path) closedTabs.push(tab.doc.path)
  if (tabs.length === 1) {
    // the last one: it stays, empty
    setDocument('', { path: null })
    return true
  }
  const i = tabs.indexOf(tab)
  if (tab === active) activate(tabs[i + 1] ?? tabs[i - 1])
  tabs.splice(tabs.indexOf(tab), 1)
  guard.onChange() // its unsaved changes are gone from the recovery copy
  updateChrome()
  return true
}

async function closeTabs(list: Tab[]) {
  for (const tab of list) if (!(await closeTab(tab))) return
}

function cycleTab(step: number) {
  const i = tabs.indexOf(active)
  activate(tabs[(i + step + tabs.length) % tabs.length])
  view.focus()
}

/** Ctrl+Shift+T: the tab closed last comes back. */
async function reopenClosedTab() {
  const path = closedTabs.pop()
  if (path) await openPath(path)
}

/** A tab as a recovery copy / for the session. */
function tabRecovery(tab: Tab): host.RecoveryData {
  const state = tabState(tab)
  const dirty = tabDirty(tab)
  return {
    path: tab.doc.path,
    markdown: dirty ? (tab === active ? markdown() : exportMarkdown(state.doc, tab.doc.meta)) : null,
    eol: tab.doc.eol,
    bom: tab.doc.bom,
    diskHash: tab.doc.diskHash,
    savedAt: Date.now(),
    cursor: state.selection.head,
    scroll: tab === active ? $('#scroller').scrollTop : tab.scroll,
  }
}

/** A remembered or recovered document back in a tab; its id (null: nothing to show). */
async function restoreTab(data: host.RecoveryData): Promise<number | null> {
  // reading the file also allows its images and finds the repository root for `/…` paths
  const file = data.path ? await host.readFile(data.path).catch(() => null) : null
  const open = data.path ? tabs.find((x) => samePath(x.doc.path, data.path)) : undefined
  if (data.markdown === null) {
    // a session without unsaved changes: just reopen the file (if it still exists)
    if (open) return open.id
    if (!file) return null
    tabForNewDocument()
    setDocument(file.text, file)
    void rememberRecent(file.path)
  } else {
    if (open && !tabDirty(open)) activate(open)
    else tabForNewDocument()
    setDocument(data.markdown, { path: data.path, eol: data.eol, bom: data.bom, hash: data.diskHash, root: file?.root })
    doc.saved = null // restored changes are unsaved
  }
  restorePosition(data.cursor)
  if (data.scroll !== undefined) $('#scroller').scrollTop = active.scroll = data.scroll
  updateChrome()
  return active.id
}

const tabBar = createTabBar($('#tabbar'), {
  activate: (id) => {
    const tab = tabs.find((x) => x.id === id)
    if (tab) activate(tab)
  },
  close: (id) => {
    const tab = tabs.find((x) => x.id === id)
    if (tab) void closeTab(tab)
  },
  create: () => {
    newTab()
    view.focus()
  },
  menu: (id, anchor) => {
    const tab = tabs.find((x) => x.id === id)
    if (tab) openMenu(anchor, tabMenu(tab))
  },
  move: (id, index) => {
    const tab = tabs.find((x) => x.id === id)
    if (!tab) return
    tabs.splice(tabs.indexOf(tab), 1)
    tabs.splice(index, 0, tab)
    updateChrome()
  },
})

function tabMenu(tab: Tab): MenuItem[] {
  const i = tabs.indexOf(tab)
  const path = tab.doc.path
  return [
    { label: t('tabs.close'), shortcut: kbd('Ctrl+W'), run: () => void closeTab(tab) },
    { label: t('tabs.closeOthers'), disabled: tabs.length < 2, run: () => void closeTabs(tabs.filter((x) => x !== tab)) },
    { label: t('tabs.closeRight'), disabled: i === tabs.length - 1, run: () => void closeTabs(tabs.slice(i + 1)) },
    { label: t('tabs.closeAll'), run: () => void closeTabs([...tabs]) },
    'separator',
    { label: t('tabs.copyPath'), disabled: !path, run: () => path && void navigator.clipboard.writeText(path) },
    ...(host.isTauri
      ? [
          { label: t('tabs.reveal'), disabled: !path, run: () => path && void host.revealFile(path).catch(() => {}) },
          { label: t('tabs.showInTree'), disabled: !path || !fileTree, run: () => path && void fileTree?.show(path) },
        ]
      : []),
  ]
}

/** What the tab bar shows (names: with the folder when two tabs have the same name). */
function tabInfos(): TabInfo[] {
  const names = tabs.map(tabName)
  return tabs.map((tab, i) => {
    const twice = names.some((n, k) => k !== i && n.toLowerCase() === names[i].toLowerCase())
    const dir = tab.doc.path ? host.dirname(tab.doc.path) : ''
    return {
      id: tab.id,
      name: names[i],
      hint: twice && dir ? host.basename(dir) : '',
      title: tab.doc.path ?? (tab.doc.suggested ? t('doc.newFrom', { path: tab.doc.suggested }) : t('doc.new')),
      dirty: tabDirty(tab),
      active: tab === active,
    }
  })
}

// ------------------------------------------------------------------ documents

/** Load `text` into the tab in front (undo history starts anew). */
function setDocument(text: string, file: FileInfo) {
  const { doc: pm, meta } = text ? importMarkdown(text) : { doc: null, meta: NEW_DOC_META }
  // path/root first: the editor resolves image paths while rendering the new document
  doc = active.doc = {
    path: file.path,
    root: file.root ?? (file.path ? host.dirname(file.path) : null),
    eol: file.eol ?? 'lf',
    bom: file.bom ?? false,
    mixedEol: file.mixedEol ?? false,
    meta,
    saved: view.state.doc,
    diskHash: file.hash ?? null,
    suggested: file.suggested ?? null,
  }
  editor.load(pm ?? view.state.schema.nodes.doc.create(null, view.state.schema.nodes.paragraph.create()))
  doc.saved = view.state.doc
  guard.onChange() // what was unsaved in this tab before is gone
  updateChrome()
  view.focus()
}

/** Run a user-facing decision without background checks popping up in between. */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  busy = true
  try {
    return await fn()
  } finally {
    busy = false
  }
}

/** Before the document goes away: offer to save changes. false = the user cancelled. */
function confirmDiscard(): Promise<boolean> {
  return exclusive(async () => {
    if (!isDirty()) return true
    const choice = await askSaveChanges(docName())
    if (choice === 'save') return saveFile(false)
    return choice === 'discard'
  })
}

async function openPath(path: string) {
  if (isWorkspaceFile(path)) return openWorkspace(path)
  // open already: its tab comes to the front
  const open = tabs.find((x) => samePath(x.doc.path, path))
  if (open) return activate(open)
  try {
    const f = await host.readFile(path)
    if (host.isHtmlFile(path)) return await importHtml(f)
    tabForNewDocument()
    setDocument(f.text, f)
    void rememberRecent(f.path)
  } catch (e) {
    await host.showError(t('err.open', { error: String(e) }))
  }
}

/**
 * HTML → new, unsaved Markdown document. Shows what Markdown can't keep first.
 * The HTML file itself is never written: "Save" proposes <name>.md next to it.
 */
async function importHtml(f: host.MdFile) {
  const name = host.basename(f.path)
  const result = htmlToMarkdown(f.text)
  if (result.losses.length) {
    const MAX = 12
    const list = result.losses
      .slice(0, MAX)
      .map((l) => `•  ${l.label}${l.count > 1 ? `  (${l.count}×)` : ''}`)
      .join('\n')
    const more = result.losses.length > MAX ? `\n•  ${t('import.more', { n: result.losses.length - MAX })}` : ''
    const choice = await exclusive(() =>
      askChoice(
        t('import.title', { name }),
        `${t('import.intro')}\n\n${list}${more}\n\n${t('import.kept')}\n\n${t('import.newDoc')}`,
        [
          { label: t('common.cancel'), value: 'cancel' },
          { label: t('import.button'), value: 'import', primary: true },
        ],
      ),
    )
    if (choice !== 'import') return
  }
  tabForNewDocument()
  setDocument(result.markdown, { path: null, suggested: `${withoutExt(f.path)}.md`, root: f.root })
  void rememberRecent(f.path)
  doc.saved = null // a new document: not saved yet
  updateChrome()
  flash(t('import.done', { name, md: `${withoutExt(name)}.md` }))
}

/** Re-read the current file (changed by another program), keeping cursor and scroll position. */
async function reloadFromDisk() {
  if (!doc.path) return
  const scroller = $('#scroller')
  const top = scroller.scrollTop
  const at = view.state.selection.from
  const f = await host.readFile(doc.path)
  setDocument(f.text, f)
  const pos = Math.min(at, view.state.doc.content.size)
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))))
  scroller.scrollTop = top
}

async function openFile() {
  if (!host.isTauri) return browserOpen()
  const path = await host.pickMarkdown()
  if (path) await openPath(path)
}

/** true if the document was written. */
function saveFile(saveAs: boolean): Promise<boolean> {
  return exclusive(async () => {
    // exactly this state is written – typing during the (async) save stays "unsaved"
    const snapshot = view.state.doc
    const text = markdown()
    if (!host.isTauri) return browserSave(text)
    let path = doc.path
    if (saveAs || !path) path = await host.pickSavePath(doc.path ?? doc.suggested)
    if (!path) return false
    // the same file: it must still be the version we loaded (otherwise someone else changed it)
    const expected = path === doc.path ? doc.diskHash : null
    try {
      let hash: string
      try {
        hash = await host.writeFile(path, text, doc.eol, doc.bom, expected)
      } catch (e) {
        if (!(e instanceof host.ExternalChangeError)) throw e
        const choice = await guard.askOverwrite(host.basename(path))
        if (choice === 'cancel') {
          await guard.acknowledgeDisk() // seen it – the background check shouldn't ask again
          return false
        }
        if (choice === 'saveAs') {
          busy = false // nested save runs its own exclusive section
          return saveFile(true)
        }
        hash = await host.writeFile(path, text, doc.eol, doc.bom, expected, true)
      }
      const moved = path !== doc.path
      doc.path = path
      doc.suggested = null
      void rememberRecent(path)
      if (moved) {
        // "Save as" into another folder: relative images now resolve from there
        doc.root = host.dirname(path)
        editor.redrawNodeViews()
      }
      doc.diskHash = hash
      doc.mixedEol = false
      doc.saved = snapshot
      guard.onChange() // the recovery copy: without this tab's changes now
      updateChrome()
      return true
    } catch (e) {
      await host.showError(t('err.save', { error: String(e) }))
      return false
    }
  })
}

/** Close = close the tab in front. */
async function closeDocument() {
  await closeTab(active)
}

// ------------------------------------------------------------------ pasted images

/** Folder next to the document where pasted images go. */
const PASTE_FOLDER = 'images'

async function pasteImage(v: EditorView, image: File) {
  if (!host.isTauri) return flash(t('paste.browser'))
  // the image is stored next to the document – so the document needs a place first
  if (!doc.path) {
    const choice = await exclusive(() =>
      askChoice(
        t('paste.title'),
        t('paste.needSave', { folder: PASTE_FOLDER }),
        [
          { label: t('common.cancel'), value: 'cancel' },
          { label: t('common.saveAs'), value: 'save', primary: true },
        ],
      ),
    )
    if (choice !== 'save' || !(await saveFile(true)) || !doc.path) return
  }
  try {
    const bytes = new Uint8Array(await image.arrayBuffer())
    const rel = await host.savePastedImage(host.dirname(doc.path), PASTE_FOLDER, pastedImageStem(), imageExtension(image.type), bytes)
    const node = v.state.schema.nodes.image.create({ src: host.encodePath(rel), alt: '' })
    v.dispatch(v.state.tr.replaceSelectionWith(node, false).scrollIntoView())
    v.focus()
    flash(t('paste.saved', { path: rel }))
  } catch (e) {
    await host.showError(t('err.imageSave', { error: String(e) }))
  }
}

// ------------------------------------------------------------------ recently opened files

/** Synchronous copy for building the menu. */
let recentCache: string[] = []
void recentFiles().then((list) => (recentCache = list))

async function rememberRecent(path: string) {
  if (!host.isTauri) return // browser preview: no real paths
  await addRecent(path)
  recentCache = await recentFiles()
}

function openMenuItems(): MenuItem[] {
  const items: MenuItem[] = [{ label: t('menu.open'), shortcut: kbd('Ctrl+O'), run: () => void openFile() }]
  if (!host.isTauri) return items
  items.push('separator', { label: t('menu.wsOpen'), run: () => void showWorkspaces() }, { label: t('menu.wsNew'), run: () => void newWorkspace() })
  if (workspace) {
    const name = workspace.data.name
    items.push({ label: t('menu.wsSettings', { name }), run: () => void workspaceSettings() }, { label: t('menu.wsClose', { name }), run: () => void closeWorkspace() })
  }
  items.push('separator')
  if (!recentCache.length) items.push({ label: t('menu.recentEmpty'), disabled: true, run: () => {} })
  for (const p of recentCache) items.push({ label: host.basename(p), shortcut: shortDir(p), title: p, run: () => void openRecent(p) })
  if (recentCache.length) {
    items.push('separator', {
      label: t('menu.recentClear'),
      run: () => void clearRecent().then(() => (recentCache = [])),
    })
  }
  return items
}

async function openRecent(path: string) {
  if ((await host.fileHash(path)) === null) {
    await removeRecent(path)
    recentCache = await recentFiles()
    await host.showError(t('err.notFound', { name: host.basename(path), path }))
    return
  }
  await openPath(path)
}

// ------------------------------------------------------------------ workspaces

const WORKSPACE_KEY = 'mod-workspace'
let workspace: Workspace | null = null
/** the workspace's Markdown files (relative, `/`): [[Link]] is found by name in them */
let wikiIndex: string[] = []
let indexedAt = 0

/** [[Link]] not next to the document: the nearest file of that name in the workspace. */
function findWiki(target: string): string | null {
  if (!workspace) return null
  const rel = findByName(wikiIndex, target)
  return rel ? host.joinPath(workspace.root, rel) : null
}

async function refreshWikiIndex(force = false) {
  if (!workspace || (!force && Date.now() - indexedAt < 5000)) return
  const ws = workspace
  indexedAt = Date.now()
  const files = await host.markdownFiles(ws.root).catch(() => [] as string[])
  if (workspace !== ws) return
  wikiIndex = files
  window.dispatchEvent(new Event(WIKI_INDEX_EVENT))
}
// files come and go while the window is in the background
window.addEventListener('focus', () => void refreshWikiIndex())

/** Open (`ws`) or close (null) a workspace: tree, wiki links, title. */
async function useWorkspace(ws: Workspace | null) {
  workspace = ws
  wikiIndex = []
  const wiki = ws ? ws.data.wikiLinks : null
  // wiki links on/off changes how the open document is read
  if ((wiki ?? extendedSyntaxOn()) !== wikiLinksOn()) reparse(() => setWikiLinks(wiki))
  else setWikiLinks(wiki)
  store.set(WORKSPACE_KEY, ws?.path ?? null)
  await fileTree?.setWorkspace(ws ? { name: ws.data.name, root: ws.root } : null)
  if (ws) await refreshWikiIndex(true)
  else window.dispatchEvent(new Event(WIKI_INDEX_EVENT))
  lastTitle = ''
  updateChrome()
}

/** `quiet`: at start (the last workspace) – no messages, a missing one is forgotten. */
async function openWorkspace(path: string, quiet = false) {
  let ws: Workspace
  try {
    ws = await readWorkspace(path)
  } catch (e) {
    if (quiet) store.set(WORKSPACE_KEY, null)
    else await host.showError(t('err.workspace', { error: String(e) }))
    return
  }
  await useWorkspace(ws)
  await rememberWorkspace(ws)
  if (quiet) return
  if (fileTree && !fileTree.visible()) {
    fileTree.toggle()
    toolbar.update()
  }
  if (ws.data.version > WORKSPACE_VERSION) flash(t('ws.newer'), true)
  else flash(t('ws.openedFlash', { name: ws.data.name }))
}

async function closeWorkspace() {
  await useWorkspace(null)
  flash(t('ws.closed'))
}

/** A new .modw in `folder` (the tree's folder, else the document's, else one to pick). */
async function newWorkspace(folder?: string) {
  const start = folder ?? fileTree?.root() ?? (doc.path ? host.dirname(doc.path) : null) ?? (await host.pickFolder().catch(() => null))
  if (!start) return
  const suggested = host.basename(start.replace(/[\\/]+$/, '')) || 'Workspace'
  const form = await workspaceForm({ name: suggested, folder: start, wikiLinks: wikiLinksOn() }, true)
  const name = form && safeFileName(form.name)
  if (!form || !name) return
  const path = host.joinPath(form.folder, `${name}.modw`)
  if ((await host.fileHash(path).catch(() => null)) !== null) {
    const choice = await askChoice(t('ws.newTitle'), t('ws.exists', { name: `${name}.modw` }), [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('ws.openExisting'), value: 'open', primary: true },
    ])
    if (choice === 'open') await openWorkspace(path)
    return
  }
  try {
    await writeWorkspace(path, { version: WORKSPACE_VERSION, name: form.name, root: '.', wikiLinks: form.wikiLinks })
  } catch (e) {
    return void (await host.showError(t('err.workspaceSave', { error: String(e) })))
  }
  await openWorkspace(path)
}

async function workspaceSettings() {
  const ws = workspace
  if (!ws) return
  const form = await workspaceForm({ name: ws.data.name, folder: ws.root, wikiLinks: ws.data.wikiLinks }, false)
  if (!form) return
  try {
    // read it again: keep what was changed meanwhile (or written by a newer version)
    const fresh = await readWorkspace(ws.path).catch(() => ws)
    const root = samePath(form.folder, ws.root) ? fresh.data.root : relativePath(host.dirname(ws.path), form.folder)
    const saved = await writeWorkspace(ws.path, { ...fresh.data, name: form.name, wikiLinks: form.wikiLinks, root })
    await useWorkspace(saved)
    await rememberWorkspace(saved)
  } catch (e) {
    await host.showError(t('err.workspaceSave', { error: String(e) }))
  }
}

function showWorkspaces() {
  return openWorkspaceWindow({
    current: workspace?.path ?? null,
    open: (p) => void openWorkspace(p),
    pickFile: async () => {
      const p = await host.pickWorkspace().catch(() => null)
      if (p) await openWorkspace(p)
    },
    create: () => void newWorkspace(),
  })
}

// ------------------------------------------------------------------ HTML export, clipboard, print

const htmlTitle = () => documentTitle(markdown(), withoutExt(docName()))

async function exportHtml() {
  const md = markdown()
  const page = renderHtmlPage(md, htmlTitle(), getLang(), await renderOptions(md))
  if (!host.isTauri) return download(page, `${withoutExt(docName())}.html`, 'text/html')
  const path = await host.pickHtmlSavePath(`${withoutExt(doc.path ?? docName())}.html`)
  if (!path) return
  try {
    await host.writeText(path, page)
    flash(t('flash.htmlExported', { path }))
  } catch (e) {
    await host.showError(t('err.htmlExport', { error: String(e) }))
  }
}

async function copyHtml() {
  try {
    // formulas as MathML (self-contained); code colours would need the page's stylesheet
    const md = markdown()
    await host.copyHtml(renderHtml(md, { math: (await renderOptions(md)).math }))
    flash(t('flash.htmlCopied'))
  } catch (e) {
    await host.showError(t('err.copy', { error: String(e) }))
  }
}

/**
 * "Save as PDF": the page of the HTML export, printed to a file by the web engine
 * (Windows); elsewhere the print dialog, which saves PDFs too.
 */
async function exportPdf() {
  if (!host.pdfDirect) {
    flash(t('flash.pdfViaPrint'))
    return printDocument()
  }
  const path = await host.pickPdfSavePath(`${withoutExt(doc.path ?? docName())}.pdf`)
  if (!path) return
  flash(t('flash.pdfCreating'))
  try {
    const md = markdown()
    const page = new DOMParser().parseFromString(renderHtmlPage(md, htmlTitle(), getLang(), await renderOptions(md)), 'text/html')
    // relative image paths → URLs the (hidden) window can load
    for (const img of page.images) {
      const src = img.getAttribute('src')
      if (src) img.setAttribute('src', hooks.resolveImage(src))
    }
    await host.savePdf(`<!doctype html>\n${page.documentElement.outerHTML}`, path)
    flash(t('flash.pdfSaved', { path }))
  } catch (e) {
    await host.showError(t('err.pdf', { error: String(e) }))
  }
}

function printDocument() {
  return printMarkdown(markdown(), htmlTitle(), hooks.resolveImage)
}

// ------------------------------------------------------------------ browser fallback (dev without Tauri)

function download(text: string, name: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function browserOpen() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.md,.markdown,.txt,text/markdown'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const raw = await file.text()
    const crlf = (raw.match(/\r\n/g) ?? []).length
    const lf = (raw.match(/\n/g) ?? []).length - crlf
    tabForNewDocument()
    setDocument(raw.replace(/^﻿/, '').replace(/\r\n/g, '\n'), { path: file.name, eol: crlf > lf ? 'crlf' : 'lf', bom: raw.startsWith('﻿') })
  }
  input.click()
}

function browserSave(text: string): boolean {
  const out = (doc.bom ? '﻿' : '') + (doc.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text)
  download(out, docName(), 'text/markdown')
  doc.saved = view.state.doc
  updateChrome()
  return true
}

// ------------------------------------------------------------------ global keys, window, drag & drop

window.addEventListener(
  'keydown',
  (e) => {
    // dialogs (picker, config editor …) handle their own keys
    if (modalOpen()) return
    const run = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (e.key === 'F1') return run(() => void host.openExternal(HELP_URL))
    // back / forward after following links
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') return run(() => void travel('back'))
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight') return run(() => void travel('forward'))
    if (e.key === 'F3') return run(() => findBar.next(e.shiftKey ? -1 : 1))
    if (e.key === 'Escape' && findBar.isOpen()) return run(() => findBar.close())
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 's') run(() => void saveFile(e.shiftKey))
    else if (k === 'o' && !e.shiftKey) run(() => void openFile())
    else if ((k === 'n' || k === 't') && !e.shiftKey) run(() => (newTab(), view.focus()))
    else if (k === 't' && e.shiftKey) run(() => void reopenClosedTab())
    else if (k === 'w' && !e.shiftKey) run(() => void closeDocument())
    else if (k === 'tab') run(() => cycleTab(e.shiftKey ? -1 : 1))
    else if (k === 'pagedown' && !e.shiftKey) run(() => cycleTab(1))
    else if (k === 'pageup' && !e.shiftKey) run(() => cycleTab(-1))
    else if (k === 'p' && !e.shiftKey) run(() => void printDocument())
    else if (k === 'e' && e.shiftKey) run(() => void exportHtml())
    else if (k === 'm' && e.shiftKey) run(toggleSource)
    else if (k === 'b' && e.shiftKey && fileTree) run(() => (fileTree!.toggle(), toolbar.update()))
    else if (k === 'f' && !e.shiftKey) run(() => findBar.open(false))
    else if (k === 'h' && !e.shiftKey) run(() => findBar.open(true))
  },
  true,
)

async function setupWindow(view: EditorView) {
  if (!host.isTauri) {
    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) e.preventDefault()
    })
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')

  // closing the window (also Cmd+Q on macOS)
  await getCurrentWindow().onCloseRequested(async (e) => {
    // remember the session: the tabs (unsaved changes included) come back next time
    if (sessionEnabled()) return guard.saveSession()
    // otherwise: Save / Don't save / Cancel for each tab with changes
    for (const tab of [...tabs]) {
      if (!tabDirty(tab)) continue
      activate(tab)
      if (!(await confirmDiscard())) return e.preventDefault()
    }
    // leaving on purpose: no recovery copy must survive (it would be offered next time)
    await guard.clearRecovery()
  })

  // macOS "Open with…" / double-click while the app runs (at startup: initialFile)
  const { listen } = await import('@tauri-apps/api/event')
  await listen('open-file', async () => {
    const p = await host.initialFile()
    if (p) await openPath(p)
  })

  // Windows blocks drag & drop from Explorer into an elevated (admin) process.
  if (await host.isElevated()) {
    elevatedWarning = true
    updateChrome()
  }

  // Drop a .md to open it, drop images to insert them at the drop point.
  await getCurrentWebview().onDragDropEvent(async (e) => {
    if (e.payload.type !== 'drop') return
    const paths = e.payload.paths
    const ws = paths.find(isWorkspaceFile)
    if (ws) return void (await openWorkspace(ws))
    // documents: each in a tab
    const docs = paths.filter((p) => host.isMarkdownFile(p) || host.isHtmlFile(p))
    if (docs.length) {
      for (const p of docs) await openPath(p)
      return
    }
    const images = paths.filter((p) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i.test(p))
    if (!images.length) return
    const ratio = window.devicePixelRatio || 1
    const at = view.posAtCoords({ left: e.payload.position.x / ratio, top: e.payload.position.y / ratio })
    const { schema } = view.state
    let tr = view.state.tr
    let pos = at?.pos ?? view.state.selection.from
    for (const p of images) {
      const node = schema.nodes.image.create({ src: host.relativeImagePath(p, doc.path), alt: host.basename(p).replace(/\.[^.]+$/, '') })
      tr = tr.insert(pos, node)
      pos += node.nodeSize
    }
    view.dispatch(tr)
    view.focus()
  })
}

// ------------------------------------------------------------------ language

/** Texts that live in index.html. */
function applyStaticTexts() {
  document.documentElement.lang = getLang()
  $('#toolbar').setAttribute('aria-label', t('toolbar.label'))
  $('#tabbar').setAttribute('aria-label', t('tabs.label'))
  $('#source-pane').setAttribute('aria-label', t('source.title'))
  $('#source-pane .pane-title').textContent = t('source.title')
  $('#zoom').setAttribute('aria-label', t('zoom.label'))
  // labels of raw blocks (CSS ::before)
  const labels: [string, MessageKey][] = [
    ['raw', 'block.raw'],
    ['table', 'block.table'],
    ['front-matter', 'block.frontMatter'],
    ['definition', 'block.definition'],
  ]
  for (const [name, key] of labels) document.documentElement.style.setProperty(`--lbl-${name}`, JSON.stringify(t(key)))
}

onLangChange(() => {
  toolbar = createToolbar($('#toolbar'), view, toolbarActions())
  toolbar.update()
  findBar.relabel()
  editor.redrawNodeViews() // tooltips of raw elements
  zoom.relabel()
  fileTree?.relabel()
  applyStaticTexts()
  lastTitle = ''
  updateChrome()
})

// ------------------------------------------------------------------ start

applyStaticTexts()
setDocument('', { path: null })
void setupWindow(view)
// reveal the page (and the window, which Tauri creates hidden) once the editor is painted
requestAnimationFrame(() => {
  document.body.classList.add('ready')
  // the window starts hidden: a hidden window can't take the focus, so give it to the editor once shown
  if (host.isTauri) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show().then(() => getCurrentWindow().setFocus()).then(refocusEditor))
})
void (async () => {
  const p = await host.initialFile()
  if (p && isWorkspaceFile(p)) await openWorkspace(p)
  else {
    // the workspace of last time (before any document: it decides how [[…]] is read)
    const last = store.get<string | null>(WORKSPACE_KEY, null)
    if (last) await openWorkspace(last, true)
  }
  // continue the last session (its tabs), offer unsaved changes left by a crash
  await guard.offerRecovery()
  // a file opened with the app: in a tab of its own, in front
  if (p && !isWorkspaceFile(p)) await openPath(p)
})()

// Dev hook for testing in the browser console / pane.
if (import.meta.env.DEV) Object.assign(window, { mod: { setDocument, markdown, view, guard, history, isDirty: () => isDirty(), tabs: () => tabs, workspace: () => workspace, wikiIndex: () => wikiIndex } })
