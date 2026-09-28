import './style.css'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { importMarkdown, exportMarkdown, NEW_DOC_META, type DocMeta } from './md/document'
import { documentTitle, renderHtml, renderHtmlPage } from './md/html'
import { createEditor, editImage, editLink, insertEmoji, type EditorHooks } from './editor/editor'
import { createToolbar } from './editor/toolbar'
import { askChoice, askSaveChanges } from './editor/dialog'
import { htmlToMarkdown } from './md/htmlImport'
import { HELP_URL, showAbout } from './editor/about'
import { printMarkdown } from './editor/print'
import { createFindBar } from './editor/findbar'
import { modalOpen } from './editor/modal'
import * as host from './platform'
import { createGuard } from './guard'
import { Selection } from 'prosemirror-state'

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

let doc!: DocState
let sourceVisible = false
let elevatedWarning = false
let flashMessage: string | null = null

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
  openExternal: (href) => void host.openExternal(href),
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
  markdown: () => markdown(),
  reload: () => reloadFromDisk(),
  restore: (data) => {
    setDocument(data.markdown, { path: data.path, eol: data.eol, bom: data.bom, hash: data.diskHash })
    doc.saved = null // restored changes are unsaved
    updateChrome()
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
const toolbar = createToolbar($('#toolbar'), view, {
  open: () => void openFile(),
  save: () => void saveFile(false),
  saveAs: () => void saveFile(true),
  close: () => void closeDocument(),
  print: () => void printDocument(),
  exportHtml: () => void exportHtml(),
  copyHtml: () => void copyHtml(),
  help: () => void host.openExternal(HELP_URL),
  about: () => void showAbout(),
  link: (v) => void editLink(v),
  image: (v) => void editImage(v, hooks),
  emoji: (v) => void insertEmoji(v),
  find: () => findBar.open(false),
  toggleSource,
  sourceVisible: () => sourceVisible,
})
const findBar = createFindBar($('#workspace'), view)

// ------------------------------------------------------------------ UI updates

const isDirty = () => doc.saved === null || !view.state.doc.eq(doc.saved)
const markdown = () => exportMarkdown(view.state.doc, doc.meta)
const docName = () => host.basename(doc.path ?? doc.suggested ?? 'Unbenannt.md')
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
  const title = `${isDirty() ? '● ' : ''}${docName()} — Mark O Down`
  if (title !== lastTitle) void host.setWindowTitle((lastTitle = title))

  const text = view.state.doc.textContent
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const parts = [doc.path ?? (doc.suggested ? `Neu (noch nicht gespeichert): ${doc.suggested}` : 'Neues Dokument'), `${words} Wörter`, doc.eol.toUpperCase(), doc.bom ? 'UTF-8 mit BOM' : 'UTF-8']
  if (doc.mixedEol) parts.push('⚠ gemischte Zeilenenden – werden beim Speichern vereinheitlicht')
  if (elevatedWarning) parts.unshift('⚠ Als Administrator gestartet – Windows blockiert Drag & Drop aus dem Explorer; App ohne Admin-Rechte starten')
  // Opened in a plain browser (e.g. the dev server URL): no real file access
  if (!host.isTauri) parts.unshift('⚠ Browser-Vorschau – Speichern = Download, kein Drag & Drop; für volle Funktion die App starten')
  if (flashMessage) parts.unshift(`✓ ${flashMessage}`)
  statusEl.textContent = parts.join('   ·   ')

  if (sourceVisible) sourceEl.value = markdown()
}

/** Short confirmation in the status bar. */
let flashTimer = 0
function flash(message: string) {
  flashMessage = message
  updateChrome()
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    flashMessage = null
    updateChrome()
  }, 4000)
}

function toggleSource() {
  sourceVisible = !sourceVisible
  document.body.classList.toggle('show-source', sourceVisible)
  updateChrome()
  toolbar.update()
}

// ------------------------------------------------------------------ documents

function setDocument(text: string, file: FileInfo) {
  const { doc: pm, meta } = text ? importMarkdown(text) : { doc: null, meta: NEW_DOC_META }
  // path/root first: the editor resolves image paths while rendering the new document
  doc = {
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
  void guard.clearRecovery()
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
  try {
    const f = await host.readFile(path)
    if (host.isHtmlFile(path)) return await importHtml(f)
    setDocument(f.text, f)
  } catch (e) {
    await host.showError(`Datei konnte nicht geöffnet werden:\n${e}`)
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
    const more = result.losses.length > MAX ? `\n•  … und ${result.losses.length - MAX} weitere` : ''
    const choice = await exclusive(() =>
      askChoice(
        `„${name}“ als Markdown importieren?`,
        `Markdown kann nicht alles darstellen, was HTML kann. Beim Import geht verloren:\n\n${list}${more}\n\n` +
          'Erhalten bleiben Überschriften, Absätze, fett/kursiv, Links, Bilder, Listen, Tabellen, Code und Zitate – ' +
          'sowie <div align="center">, <br> und <img> mit Größenangabe.\n\n' +
          'Es entsteht ein neues Markdown-Dokument, die HTML-Datei bleibt unverändert.',
        [
          { label: 'Abbrechen', value: 'cancel' },
          { label: 'Importieren', value: 'import', primary: true },
        ],
      ),
    )
    if (choice !== 'import') return
  }
  setDocument(result.markdown, { path: null, suggested: `${withoutExt(f.path)}.md`, root: f.root })
  doc.saved = null // a new document: not saved yet
  updateChrome()
  flash(`„${name}“ als Markdown importiert – „Speichern“ legt ${withoutExt(name)}.md an`)
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
  if (!(await confirmDiscard())) return
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
      if (moved) {
        // "Save as" into another folder: relative images now resolve from there
        doc.root = host.dirname(path)
        editor.refreshImages()
      }
      doc.diskHash = hash
      doc.mixedEol = false
      doc.saved = snapshot
      if (!isDirty()) void guard.clearRecovery()
      updateChrome()
      return true
    } catch (e) {
      await host.showError(`Speichern fehlgeschlagen:\n${e}`)
      return false
    }
  })
}

/** Close = back to an empty, unsaved document. */
async function closeDocument() {
  if (await confirmDiscard()) setDocument('', { path: null })
}

// ------------------------------------------------------------------ HTML export, clipboard, print

const htmlTitle = () => documentTitle(markdown(), withoutExt(docName()))

async function exportHtml() {
  const page = renderHtmlPage(markdown(), htmlTitle())
  if (!host.isTauri) return download(page, `${withoutExt(docName())}.html`, 'text/html')
  const path = await host.pickHtmlSavePath(`${withoutExt(doc.path ?? docName())}.html`)
  if (!path) return
  try {
    await host.writeText(path, page)
    flash(`HTML exportiert: ${path}`)
  } catch (e) {
    await host.showError(`HTML-Export fehlgeschlagen:\n${e}`)
  }
}

async function copyHtml() {
  try {
    await host.copyHtml(renderHtml(markdown()))
    flash('HTML in die Zwischenablage kopiert')
  } catch (e) {
    await host.showError(`Kopieren fehlgeschlagen:\n${e}`)
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
    if (e.key === 'F3') return run(() => findBar.next(e.shiftKey ? -1 : 1))
    if (e.key === 'Escape' && findBar.isOpen()) return run(() => findBar.close())
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 's') run(() => void saveFile(e.shiftKey))
    else if (k === 'o' && !e.shiftKey) run(() => void openFile())
    else if (k === 'n' && !e.shiftKey) run(() => void closeDocument())
    else if (k === 'w' && !e.shiftKey) run(() => void closeDocument())
    else if (k === 'p' && !e.shiftKey) run(() => void printDocument())
    else if (k === 'e' && e.shiftKey) run(() => void exportHtml())
    else if (k === 'm' && e.shiftKey) run(toggleSource)
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

  // closing the window: Speichern / Nicht speichern / Abbrechen
  await getCurrentWindow().onCloseRequested(async (e) => {
    if (!(await confirmDiscard())) return e.preventDefault()
    // leaving on purpose: no recovery copy must survive (it would be offered next time)
    await guard.clearRecovery()
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
    const md = paths.find((p) => host.isMarkdownFile(p) || host.isHtmlFile(p))
    if (md) {
      if (await confirmDiscard()) await openPath(md)
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

// ------------------------------------------------------------------ start

setDocument('', { path: null })
void setupWindow(view)
// reveal the page (and the window, which Tauri creates hidden) once the editor is painted
requestAnimationFrame(() => {
  document.body.classList.add('ready')
  if (host.isTauri) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show())
})
void (async () => {
  const p = await host.initialFile()
  if (p) await openPath(p)
  // after a crash: offer the unsaved changes that were left behind
  await guard.offerRecovery()
})()

// Dev hook for testing in the browser console / pane.
if (import.meta.env.DEV) Object.assign(window, { mod: { setDocument, markdown, view, guard, isDirty: () => isDirty() } })
