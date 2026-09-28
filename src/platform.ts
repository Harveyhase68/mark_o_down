// Host integration. In Tauri everything goes through Rust; in a plain browser
// (`npm run dev` without Tauri) a minimal fallback keeps the editor usable.

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { t } from './i18n'

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
  /** Hash of the bytes on disk, to detect changes by other programs. */
  hash: string
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const MD_EXT = ['md', 'markdown', 'mdown', 'mkd', 'txt']
const HTML_EXT = ['html', 'htm']
// functions: the names follow the UI language
const MD_FILTER = () => [{ name: t('dialog.markdown'), extensions: MD_EXT }]
const OPEN_FILTER = () => [
  { name: t('dialog.markdownAndHtml'), extensions: [...MD_EXT, ...HTML_EXT] },
  { name: t('dialog.markdown'), extensions: MD_EXT },
  { name: t('dialog.htmlImport'), extensions: HTML_EXT },
]

/** Files the editor opens: Markdown directly, HTML via conversion. */
const extension = (p: string) => /\.([^.\\/]+)$/.exec(p)?.[1].toLowerCase() ?? ''
export const isMarkdownFile = (p: string) => MD_EXT.includes(extension(p))
export const isHtmlFile = (p: string) => HTML_EXT.includes(extension(p))

const IMG_FILTER = () => [{ name: t('dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'] }]

export async function readFile(path: string): Promise<MdFile> {
  try {
    return await invoke<MdFile>('read_markdown', { path })
  } catch (e) {
    // Rust sends a code for non-UTF-8 files; show it in the user's language
    const m = /^INVALID_UTF8:(\d+)$/.exec(String(e))
    throw m ? new Error(t('err.invalidUtf8', { byte: m[1] })) : e
  }
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

/** The file on disk changed since it was loaded/saved (another program wrote it). */
export class ExternalChangeError extends Error {
  constructor() {
    super(t('guard.externalChange'))
  }
}

/**
 * Save. `expected` = hash of the file as loaded/last saved: if the file on disk
 * differs, nothing is written and ExternalChangeError is thrown (unless `force`).
 * Returns the new hash.
 */
export async function writeFile(path: string, text: string, eol: Eol, bom: boolean, expected: string | null, force = false): Promise<string> {
  try {
    return await invoke<string>('write_markdown', { path, text, eol, bom, expected, force })
  } catch (e) {
    if (e === 'EXTERNAL_CHANGE') throw new ExternalChangeError()
    throw e
  }
}

/** Current hash of a file; null if it doesn't exist (anymore). */
export async function fileHash(path: string): Promise<string | null> {
  return isTauri ? invoke<string | null>('file_hash', { path }) : null
}

// ------------------------------------------------------------------ crash recovery

export interface RecoveryData {
  /** Document path (null = never saved). */
  path: string | null
  markdown: string
  eol: Eol
  bom: boolean
  /** Hash of the file on disk the changes are based on. */
  diskHash: string | null
  savedAt: number
}

export async function recoveryWrite(data: RecoveryData): Promise<void> {
  if (isTauri) await invoke('recovery_write', { data: JSON.stringify(data) })
}

export async function recoveryClear(): Promise<void> {
  if (isTauri) await invoke('recovery_clear')
}

/** Recovery copies left by crashed instances. */
export async function recoveryOrphans(): Promise<{ id: string; data: RecoveryData }[]> {
  if (!isTauri) return []
  const list = await invoke<{ id: string; data: string }[]>('recovery_orphans')
  return list.flatMap(({ id, data }) => {
    try {
      return [{ id, data: JSON.parse(data) as RecoveryData }]
    } catch {
      return [] // unreadable leftovers are ignored
    }
  })
}

export async function recoveryRemove(id: string): Promise<void> {
  if (isTauri) await invoke('recovery_remove', { id })
}

export async function initialFile(): Promise<string | null> {
  return isTauri ? invoke<string | null>('initial_file') : null
}

export async function pickMarkdown(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const p = await open({ multiple: false, directory: false, filters: OPEN_FILTER() })
  return typeof p === 'string' ? p : null
}

export async function pickSavePath(suggested: string | null): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggested ?? t('doc.untitled'), filters: MD_FILTER() })
}

export async function pickImagePath(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const p = await open({ multiple: false, directory: false, filters: IMG_FILTER() })
  return typeof p === 'string' ? p : null
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
  let path = decodePath(src.split(/[?#]/)[0])
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
  return encodePath([...Array(from.length - i).fill('..'), ...to.slice(i)].join('/'))
}

/**
 * File path → Markdown/URL path: only what would break it is encoded
 * (`%`, space, and `#`/`?` which would start a fragment/query). Umlauts stay readable.
 */
export function encodePath(path: string): string {
  return path.replace(/[% #?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

/** URL path → file path; decodes every %XX (also %23 = #, which decodeURI keeps). */
export function decodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg // a literal % that isn't an escape
      }
    })
    .join('/')
}

/** True if the app runs with administrator rights (Windows), which blocks drag & drop from Explorer. */
export async function isElevated(): Promise<boolean> {
  return isTauri ? invoke<boolean>('is_elevated').catch(() => false) : false
}

// ------------------------------------------------------------------ export

export async function pickHtmlSavePath(suggested: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: suggested, filters: [{ name: t('dialog.html'), extensions: HTML_EXT }] })
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
    throw new Error(t('err.clipboard'))
  }
}

// ------------------------------------------------------------------ pasted images

/** Save image bytes as `<dir>/<subdir>/<stem>.<ext>` (never overwrites); returns the relative path. */
export async function savePastedImage(dir: string, subdir: string, stem: string, ext: string, bytes: Uint8Array): Promise<string> {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return invoke<string>('save_pasted_image', { dir, subdir, stem, ext, data: btoa(binary) })
}
