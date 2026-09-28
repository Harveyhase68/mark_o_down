// Recently opened files (stored as recent.json in the app config folder).

import * as host from './platform'

const FILE = 'recent.json'
export const MAX_RECENT = 10

let list: string[] = []
let loaded: Promise<void> | null = null

/** Windows paths are case-insensitive: C:\A\x.md and c:\a\X.md are the same file. */
const same = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

function load(): Promise<void> {
  loaded ??= host
    .configRead(FILE)
    .then((text) => {
      const parsed = text ? (JSON.parse(text) as unknown) : []
      list = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT) : []
    })
    .catch(() => {
      list = []
    })
  return loaded
}

const save = () => host.configWrite(FILE, JSON.stringify(list, null, 2) + '\n').catch(() => {})

/** Most recent first. */
export async function recentFiles(): Promise<string[]> {
  await load()
  return [...list]
}

export async function addRecent(path: string) {
  await load()
  list = [path, ...list.filter((p) => !same(p, path))].slice(0, MAX_RECENT)
  await save()
}

export async function removeRecent(path: string) {
  await load()
  list = list.filter((p) => !same(p, path))
  await save()
}

export async function clearRecent() {
  list = []
  await save()
}

/** "C:\Users\me\Projekte\mark_o_down" → "…\Projekte\mark_o_down" */
export function shortDir(path: string): string {
  const parts = host.dirname(path).split(/[\\/]/)
  return parts.length > 3 ? `…\\${parts.slice(-2).join('\\')}` : parts.join('\\')
}
