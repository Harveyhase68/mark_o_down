// Host integration. In Tauri everything goes through Rust; in a plain browser
// (`npm run dev` without Tauri) a minimal fallback keeps the editor usable.

import { invoke, convertFileSrc } from '@tauri-apps/api/core'

export type Eol = 'lf' | 'crlf'

export interface MdFile {
  /** Absolute path. */
  path: string
  /** Base for `/…` image paths (Git repo root, else the document folder). */
  root: string
  text: string
  eol: Eol
  bom: boolean
  mixedEol: boolean
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }]
const IMG_FILTER = [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'] }]

export async function readFile(path: string): Promise<MdFile> {
  return invoke<MdFile>('read_markdown', { path })
}

/** Image files below `dir`, as `/`-separated relative paths. */
export async function listImages(dir: string): Promise<string[]> {
  return isTauri ? invoke<string[]>('list_images', { dir }) : []
}

// ------------------------------------------------------------------ config & cache

export async function configRead(name: string): Promise<string | null> {
  if (!isTauri) return localStorage.getItem(`mod-config:${name}`)
  return invoke<string | null>('config_read', { name })
}

export async function configWrite(name: string, text: string): Promise<void> {
  if (!isTauri) return localStorage.setItem(`mod-config:${name}`, text)
  await invoke('config_write', { name, text })
}

/** Show a config file in Explorer (selected). */
export async function revealConfigFile(name: string): Promise<void> {
  if (!isTauri) return
  const dir = await invoke<string>('config_dir')
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(joinPath(dir, name))
}

/** GET text through the disk cache (max age in hours); `force` refreshes. */
export async function fetchCached(url: string, maxAgeHours: number, force = false): Promise<string> {
  if (isTauri) return invoke<string>('fetch_cached', { url, maxAgeHours, force })
  const key = `mod-cache:${url}`
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { t: number; text: string } | null
    if (hit && !force && Date.now() - hit.t < maxAgeHours * 3600e3) return hit.text
  } catch {
    /* corrupt entry: refetch */
  }
  const text = await (await fetch(url)).text()
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), text }))
  } catch {
    /* quota: just don't cache */
  }
  return text
}

export async function writeFile(path: string, text: string, eol: Eol, bom: boolean): Promise<void> {
  await invoke('write_markdown', { path, text, eol, bom })
}

export async function initialFile(): Promise<string | null> {
  return isTauri ? invoke<string | null>('initial_file') : null
}

export async function pickMarkdown(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const p = await open({ multiple: false, directory: false, filters: MD_FILTER })
  return typeof p === 'string' ? p : null
}

export async function pickSavePath(suggested: string | null): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggested ?? 'Unbenannt.md', filters: MD_FILTER })
}

export async function pickImagePath(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const p = await open({ multiple: false, directory: false, filters: IMG_FILTER })
  return typeof p === 'string' ? p : null
}

export async function confirm(text: string, okLabel: string): Promise<boolean> {
  if (!isTauri) return window.confirm(text)
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(text, { title: 'Mark O Down', kind: 'warning', okLabel, cancelLabel: 'Abbrechen' })
}

export async function showError(text: string): Promise<void> {
  if (!isTauri) return window.alert(text)
  const { message } = await import('@tauri-apps/plugin-dialog')
  await message(text, { title: 'Mark O Down', kind: 'error' })
}

export async function openExternal(href: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(href)) return
  if (!isTauri) return void window.open(href, '_blank', 'noopener')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(href)
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setTitle(title)
}

// ------------------------------------------------------------------ paths

const sep = (p: string) => (p.includes('\\') ? '\\' : '/')
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')))
export const basename = (p: string) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)
const isFileSystemAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|\\\\)/.test(p)

/** Join and normalize `.`/`..` segments, using the separator of `base`. */
export function joinPath(base: string, rel: string): string {
  const s = sep(base)
  const parts = base.split(/[\\/]/)
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.length > 1 && parts.pop()
    else parts.push(seg)
  }
  return parts.join(s)
}

/**
 * Markdown image `src` → URL the webview can load. Like GitHub:
 * `bild.png` / `../x.png` relative to the document, `/docs/x.png` relative to
 * the repository root. URLs (`https:`, `data:` …) are used as they are.
 */
export function resolveImage(src: string, docPath: string | null, root: string | null): string {
  if (!src || (/^[a-z][a-z0-9+.-]*:/i.test(src) && !isFileSystemAbsolute(src))) return src
  if (!isTauri) return src
  let path = src.split(/[?#]/)[0]
  try {
    path = decodeURI(path)
  } catch {
    /* keep as-is */
  }
  if (!isFileSystemAbsolute(path)) {
    if (!docPath) return src
    const base = path.startsWith('/') && root ? root : dirname(docPath)
    path = joinPath(base, path)
  }
  return convertFileSrc(path)
}

/** Absolute file path → Markdown path relative to the document (`../` if needed). */
export function relativeImagePath(file: string, docPath: string | null): string {
  const norm = (p: string) => p.replace(/\\/g, '/')
  if (!docPath) return norm(file)
  const from = norm(dirname(docPath)).split('/')
  const to = norm(file).split('/')
  // different drive: no relative path possible
  if (from[0].toLowerCase() !== to[0].toLowerCase()) return norm(file)
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i].toLowerCase() === to[i].toLowerCase()) i++
  const rel = [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/')
  return rel.replace(/ /g, "%20")
}

/** True if the app runs with administrator rights (Windows), which blocks drag & drop from Explorer. */
export async function isElevated(): Promise<boolean> {
  return isTauri ? invoke<boolean>('is_elevated').catch(() => false) : false
}

// ------------------------------------------------------------------ export

export async function pickHtmlSavePath(suggested: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggested, filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] })
}

export async function writeText(path: string, text: string): Promise<void> {
  await invoke('write_text', { path, text })
}

/** Put HTML on the clipboard: rich (text/html) for Word/mail, source (text/plain) for editors. */
export async function copyHtml(html: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ])
    return
  } catch {
    // fall back to a synthetic copy event (works without clipboard permission)
  }
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/html', html)
    e.clipboardData?.setData('text/plain', html)
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  document.addEventListener('copy', onCopy, { capture: true, once: true })
  if (!document.execCommand('copy')) {
    document.removeEventListener('copy', onCopy, { capture: true })
    throw new Error('Zwischenablage nicht verfügbar')
  }
}
