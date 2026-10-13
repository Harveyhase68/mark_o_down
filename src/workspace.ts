// Workspaces: a `.modw` file (JSON) in a folder of Markdown documents. It names the folder
// the documents are in (`root`, relative to the .modw – `.`, `docs`, `../docs`) and a few
// settings; `version` lets later versions of Mark O Down read old files (and notice newer
// ones). Settings this version does not know are kept when the file is written again.
//
// Mark O Down remembers every workspace it has seen (workspaces.json in its config
// folder): the "Open workspace" window lists them, favourites on top.

import * as host from './platform'
import { wikiFile } from './md/wikilink'

export const WORKSPACE_VERSION = 1
export const WORKSPACE_EXT = 'modw'

export interface WorkspaceFile {
  version: number
  name: string
  /** the documents' folder, relative to the .modw file */
  root: string
  /** [[wiki links]] in this workspace (independent of the extended syntax) */
  wikiLinks: boolean
  [other: string]: unknown
}

export interface Workspace {
  /** the .modw file */
  path: string
  data: WorkspaceFile
  /** the documents' folder, absolute */
  root: string
}

export const isWorkspaceFile = (p: string) => /\.modw$/i.test(p)

const windowsPaths = /^[a-zA-Z]:[\\/]|^\\\\/
const same = (a: string, b: string) => (windowsPaths.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b)

// ------------------------------------------------------------------ the file

/** Read a .modw; missing settings get their defaults. Throws if it is not a workspace. */
export function parseWorkspace(text: string, fallbackName: string): WorkspaceFile {
  const raw = JSON.parse(text.replace(/^﻿/, '')) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a workspace')
  const o = raw as Record<string, unknown>
  return {
    ...o,
    version: typeof o.version === 'number' ? o.version : WORKSPACE_VERSION,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : fallbackName,
    root: typeof o.root === 'string' && o.root.trim() ? o.root.trim() : '.',
    wikiLinks: typeof o.wikiLinks === 'boolean' ? o.wikiLinks : true,
  }
}

/** The .modw text: our settings first, unknown ones after them, as they were. */
export function serializeWorkspace(data: WorkspaceFile): string {
  const { version, name, root, wikiLinks, ...rest } = data
  return JSON.stringify({ version: Math.max(version, WORKSPACE_VERSION), name, root, wikiLinks, ...rest }, null, 2) + '\n'
}

/** `to` relative to the folder `from` (`.`, `docs`, `../docs`); another drive: absolute. */
export function relativePath(from: string, to: string): string {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean)
  const a = split(from)
  const b = split(to)
  const eq = (x: string, y: string) => (windowsPaths.test(from) ? x.toLowerCase() === y.toLowerCase() : x === y)
  if (!a.length || !b.length || !eq(a[0], b[0])) return to
  let i = 0
  while (i < a.length && i < b.length && eq(a[i], b[i])) i++
  const rel = [...Array(a.length - i).fill('..'), ...b.slice(i)]
  return rel.length ? rel.join('/') : '.'
}

export async function readWorkspace(path: string): Promise<Workspace> {
  const f = await host.readFile(path)
  const data = parseWorkspace(f.text, host.basename(path).replace(/\.modw$/i, ''))
  return { path: f.path, data, root: rootOf(f.path, data.root) }
}

export const rootOf = (path: string, root: string) => (host.isFileSystemAbsolute(root) || root.startsWith('/') ? root : host.joinPath(host.dirname(path), root))

export async function writeWorkspace(path: string, data: WorkspaceFile): Promise<Workspace> {
  await host.writeText(path, serializeWorkspace(data))
  return { path, data, root: rootOf(path, data.root) }
}

// ------------------------------------------------------------------ all workspaces seen

export interface KnownWorkspace {
  path: string
  name: string
  favorite: boolean
  /** last opened (ms) */
  opened: number
}

const LIST = 'workspaces.json'
let known: KnownWorkspace[] | null = null

async function load(): Promise<KnownWorkspace[]> {
  if (known) return known
  try {
    const parsed = JSON.parse((await host.configRead(LIST)) ?? '[]') as unknown
    known = Array.isArray(parsed)
      ? parsed
          .filter((w): w is KnownWorkspace => !!w && typeof w.path === 'string')
          .map((w) => ({ path: w.path, name: String(w.name ?? ''), favorite: !!w.favorite, opened: Number(w.opened) || 0 }))
      : []
  } catch {
    known = []
  }
  return known
}

const save = () => host.configWrite(LIST, JSON.stringify(known, null, 2) + '\n').catch(() => {})

/** Copies: changing them changes nothing (setFavorite, forgetWorkspace do). */
export async function knownWorkspaces(): Promise<KnownWorkspace[]> {
  return (await load()).map((w) => ({ ...w }))
}

/** Opened (or created): into the list, or its name and date updated. */
export async function rememberWorkspace(ws: Workspace) {
  const list = await load()
  const old = list.find((w) => same(w.path, ws.path))
  if (old) Object.assign(old, { name: ws.data.name, opened: Date.now() })
  else list.push({ path: ws.path, name: ws.data.name, favorite: false, opened: Date.now() })
  await save()
}

export async function setFavorite(path: string, favorite: boolean) {
  const w = (await load()).find((x) => same(x.path, path))
  if (w) w.favorite = favorite
  await save()
}

export async function forgetWorkspace(path: string) {
  known = (await load()).filter((w) => !same(w.path, path))
  await save()
}

// ------------------------------------------------------------------ [[Link]] by name

/**
 * The file a wiki link means when it is not next to the document: in the workspace, by
 * name (`Link` → any `…/Link.md`, `sub/Link` → any `…/sub/Link.md`), like Obsidian; the
 * one nearest to the workspace folder wins. `index`: relative paths with `/`.
 */
export function findByName(index: string[], target: string): string | null {
  const t = target.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!t || t.startsWith('../') || t.startsWith('/') || host.isFileSystemAbsolute(t)) return null
  const file = wikiFile(t).toLowerCase()
  let best: string | null = null
  let depth = Infinity
  for (const p of index) {
    const l = p.toLowerCase()
    if (l !== file && !l.endsWith('/' + file)) continue
    const d = p.split('/').length
    if (d < depth || (d === depth && best !== null && p.localeCompare(best) < 0)) {
      best = p
      depth = d
    }
  }
  return best
}
