// Badge & icon sources. Everything here is data: the user can edit it as
// `badges.json` in the app config folder (Konfiguration… in the picker).
//
// URL templates use `{field}` placeholders with optional filters:
//   {x}          URL-encoded (encodeURIComponent)
//   {x|raw}      inserted as-is (e.g. "owner/repo" paths)
//   {x|shields}  shields.io static-badge escaping (`-` → `--`, `_` → `__`)
//   {x|hex}      color without leading `#`
// Query parameters that end up empty (`&logo=`) are removed automatically.

import * as host from '../platform'

export interface BadgeField {
  key: string
  label: string
  default?: string
  placeholder?: string
  /** Fixed choices (rendered as a dropdown). */
  options?: string[]
}

export interface BadgeTemplate {
  id: string
  name: string
  /** Image URL template. */
  url: string
  /** Optional link target template (the badge becomes clickable). */
  link?: string
  /** Alt text template. */
  alt?: string
  fields: BadgeField[]
}

export interface BadgeProvider {
  id: string
  name: string
  home: string
  templates: BadgeTemplate[]
}

export interface IconSet {
  id: string
  name: string
  home: string
  /** JSON index of the icons (array of {title, slug, hex, aliases?}). */
  index: string
  /** Icon image URL template; fields: slug, title, color. */
  icon: string
  /** Badge-with-logo URL template; fields: slug, title, hex, style. */
  badge: string
}

export interface PickerConfig {
  version: 1
  /** How long downloaded lists (icon index) are cached. */
  cacheHours: number
  providers: BadgeProvider[]
  iconSets: IconSet[]
}

export const CONFIG_FILE = 'badges.json'

const STYLE: BadgeField = { key: 'style', label: 'Stil', default: 'flat', options: ['flat', 'flat-square', 'plastic', 'for-the-badge', 'social'] }
const PKG = (def: string): BadgeField => ({ key: 'package', label: 'Paket', default: def })
const REPO: BadgeField = { key: 'repo', label: 'Repository (owner/name)', default: 'tauri-apps/tauri' }

export const DEFAULT_CONFIG: PickerConfig = {
  version: 1,
  cacheHours: 168,
  providers: [
    {
      id: 'shields',
      name: 'shields.io',
      home: 'https://shields.io',
      templates: [
        {
          id: 'static',
          name: 'Statisch (Label · Text · Farbe)',
          url: 'https://img.shields.io/badge/{label|shields}-{message|shields}-{color|hex}?style={style}&logo={logo}&logoColor={logoColor|hex}',
          alt: '{label}: {message}',
          fields: [
            { key: 'label', label: 'Label', default: 'Made with' },
            { key: 'message', label: 'Text', default: 'Rust' },
            { key: 'color', label: 'Farbe', default: 'orange', placeholder: 'orange, blue, #1e90ff …' },
            STYLE,
            { key: 'logo', label: 'Logo (Simple-Icons-Slug)', default: 'rust', placeholder: 'rust, github, react …' },
            { key: 'logoColor', label: 'Logo-Farbe', default: '', placeholder: 'white' },
          ],
        },
        {
          id: 'license',
          name: 'Lizenz',
          url: 'https://img.shields.io/badge/License-{license|shields}-{color|hex}.svg?style={style}',
          alt: 'License: {license}',
          link: '{link|raw}',
          fields: [
            { key: 'license', label: 'Lizenz', default: 'MIT' },
            { key: 'color', label: 'Farbe', default: 'yellow' },
            STYLE,
            { key: 'link', label: 'Link', default: 'https://opensource.org/licenses/MIT' },
          ],
        },
        { id: 'npm-v', name: 'npm Version', url: 'https://img.shields.io/npm/v/{package}?style={style}&logo=npm', alt: 'npm', link: 'https://www.npmjs.com/package/{package}', fields: [PKG('express'), STYLE] },
        { id: 'npm-dm', name: 'npm Downloads/Monat', url: 'https://img.shields.io/npm/dm/{package}?style={style}', alt: 'npm downloads', link: 'https://www.npmjs.com/package/{package}', fields: [PKG('express'), STYLE] },
        { id: 'crates', name: 'crates.io Version', url: 'https://img.shields.io/crates/v/{crate}?style={style}&logo=rust', alt: 'crates.io', link: 'https://crates.io/crates/{crate}', fields: [{ key: 'crate', label: 'Crate', default: 'serde' }, STYLE] },
        { id: 'pypi', name: 'PyPI Version', url: 'https://img.shields.io/pypi/v/{package}?style={style}&logo=pypi', alt: 'PyPI', link: 'https://pypi.org/project/{package}/', fields: [PKG('requests'), STYLE] },
        { id: 'gh-stars', name: 'GitHub Stars', url: 'https://img.shields.io/github/stars/{repo|raw}?style={style}', alt: 'GitHub stars', link: 'https://github.com/{repo|raw}/stargazers', fields: [REPO, { ...STYLE, default: 'social' }] },
        { id: 'gh-release', name: 'GitHub Release', url: 'https://img.shields.io/github/v/release/{repo|raw}?style={style}', alt: 'GitHub release', link: 'https://github.com/{repo|raw}/releases', fields: [REPO, STYLE] },
        { id: 'gh-license', name: 'GitHub Lizenz', url: 'https://img.shields.io/github/license/{repo|raw}?style={style}', alt: 'License', link: 'https://github.com/{repo|raw}/blob/HEAD/LICENSE', fields: [REPO, STYLE] },
        {
          id: 'gh-actions',
          name: 'GitHub Actions Status',
          url: 'https://img.shields.io/github/actions/workflow/status/{repo|raw}/{workflow|raw}?style={style}',
          alt: 'Build',
          link: 'https://github.com/{repo|raw}/actions',
          fields: [REPO, { key: 'workflow', label: 'Workflow-Datei', default: 'test-core.yml' }, STYLE],
        },
        { id: 'gh-commit', name: 'GitHub letzter Commit', url: 'https://img.shields.io/github/last-commit/{repo|raw}?style={style}', alt: 'Last commit', link: 'https://github.com/{repo|raw}/commits', fields: [REPO, STYLE] },
        { id: 'gh-downloads', name: 'GitHub Downloads', url: 'https://img.shields.io/github/downloads/{repo|raw}/total?style={style}', alt: 'Downloads', link: 'https://github.com/{repo|raw}/releases', fields: [REPO, STYLE] },
        { id: 'docker', name: 'Docker Pulls', url: 'https://img.shields.io/docker/pulls/{image|raw}?style={style}&logo=docker', alt: 'Docker pulls', link: 'https://hub.docker.com/r/{image|raw}', fields: [{ key: 'image', label: 'Image', default: 'library/nginx' }, STYLE] },
      ],
    },
    {
      id: 'badgen',
      name: 'badgen.net',
      home: 'https://badgen.net',
      templates: [
        {
          id: 'static',
          name: 'Statisch (Subject · Status · Farbe)',
          url: 'https://badgen.net/badge/{subject}/{status}/{color|hex}?icon={icon}',
          alt: '{subject}: {status}',
          fields: [
            { key: 'subject', label: 'Subject', default: 'license' },
            { key: 'status', label: 'Status', default: 'MIT' },
            { key: 'color', label: 'Farbe', default: 'blue', placeholder: 'blue, green, red, orange, grey …' },
            { key: 'icon', label: 'Icon', default: '', placeholder: 'github, npm, docker …' },
          ],
        },
        { id: 'npm-v', name: 'npm Version', url: 'https://badgen.net/npm/v/{package}', alt: 'npm', link: 'https://www.npmjs.com/package/{package}', fields: [PKG('express')] },
        { id: 'npm-dm', name: 'npm Downloads/Monat', url: 'https://badgen.net/npm/dm/{package}', alt: 'npm downloads', link: 'https://www.npmjs.com/package/{package}', fields: [PKG('express')] },
        { id: 'crates', name: 'crates.io Version', url: 'https://badgen.net/crates/v/{crate}', alt: 'crates.io', link: 'https://crates.io/crates/{crate}', fields: [{ key: 'crate', label: 'Crate', default: 'serde' }] },
        { id: 'pypi', name: 'PyPI Version', url: 'https://badgen.net/pypi/v/{package}', alt: 'PyPI', link: 'https://pypi.org/project/{package}/', fields: [PKG('requests')] },
        { id: 'gh-stars', name: 'GitHub Stars', url: 'https://badgen.net/github/stars/{repo|raw}', alt: 'GitHub stars', link: 'https://github.com/{repo|raw}/stargazers', fields: [REPO] },
        { id: 'gh-release', name: 'GitHub Release', url: 'https://badgen.net/github/release/{repo|raw}', alt: 'GitHub release', link: 'https://github.com/{repo|raw}/releases', fields: [REPO] },
        { id: 'gh-license', name: 'GitHub Lizenz', url: 'https://badgen.net/github/license/{repo|raw}', alt: 'License', link: 'https://github.com/{repo|raw}', fields: [REPO] },
      ],
    },
    {
      id: 'forthebadge',
      name: 'forthebadge.com',
      home: 'https://forthebadge.com',
      templates: [
        {
          id: 'generate',
          name: 'Eigenes Badge (2 Felder)',
          url: 'https://forthebadge.com/api/badges/generate?primaryLabel={primary}&secondaryLabel={secondary}&primaryBGColor={primaryColor}&secondaryBGColor={secondaryColor}&primaryIcon={icon}',
          alt: '{primary} {secondary}',
          fields: [
            { key: 'primary', label: 'Text links', default: 'BUILT WITH' },
            { key: 'secondary', label: 'Text rechts', default: 'RUST' },
            { key: 'primaryColor', label: 'Farbe links', default: '#31C4F3' },
            { key: 'secondaryColor', label: 'Farbe rechts', default: '#389AD5' },
            { key: 'icon', label: 'Icon (Slug)', default: 'rust', placeholder: 'react, github, typescript …' },
          ],
        },
        { id: 'love', name: 'Built with love', url: 'https://forthebadge.com/featured/featured-built-with-love.svg', alt: 'Built with love', fields: [] },
        { id: 'uses-badges', name: 'Uses badges', url: 'https://forthebadge.com/featured/featured-uses-badges.svg', alt: 'Uses badges', fields: [] },
        { id: 'uses-html', name: 'Uses HTML', url: 'https://forthebadge.com/featured/featured-uses-html.svg', alt: 'Uses HTML', fields: [] },
      ],
    },
  ],
  iconSets: [
    {
      id: 'simpleicons',
      name: 'Simple Icons',
      home: 'https://simpleicons.org',
      index: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json',
      icon: 'https://cdn.simpleicons.org/{slug}/{color|hex}',
      badge: 'https://img.shields.io/badge/{title|shields}-{hex|hex}?style={style}&logo={slug}&logoColor=white',
    },
  ],
}

// ------------------------------------------------------------------ templates

const FILTERS: Record<string, (v: string) => string> = {
  raw: (v) => v,
  hex: (v) => encodeURIComponent(v.replace(/^#/, '')),
  shields: (v) => encodeURIComponent(v.replace(/-/g, '--').replace(/_/g, '__')),
}

/** Fill a URL/text template and drop query parameters that ended up empty. */
export function fillTemplate(template: string, values: Record<string, string>, encode = true): string {
  const out = template.replace(/\{(\w+)(?:\|(\w+))?\}/g, (_m, key: string, filter?: string) => {
    const v = (values[key] ?? '').trim()
    if (!encode) return v
    return (filter && FILTERS[filter] ? FILTERS[filter] : encodeURIComponent)(v)
  })
  return encode ? dropEmptyParams(out) : out
}

function dropEmptyParams(url: string): string {
  const q = url.indexOf('?')
  if (q < 0) return url
  const params = url
    .slice(q + 1)
    .split('&')
    .filter((p) => p && !/=$/.test(p))
  return url.slice(0, q) + (params.length ? '?' + params.join('&') : '')
}

export function defaultValues(t: BadgeTemplate): Record<string, string> {
  return Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? '']))
}

// ------------------------------------------------------------------ load / save

export function configText(config: PickerConfig): string {
  return JSON.stringify(config, null, 2) + '\n'
}

/** Validate user JSON; throws a readable message. */
export function parseConfig(text: string): PickerConfig {
  const c = JSON.parse(text) as PickerConfig
  if (!c || typeof c !== 'object') throw new Error('Die Konfiguration muss ein JSON-Objekt sein.')
  if (!Array.isArray(c.providers)) throw new Error('"providers" fehlt oder ist keine Liste.')
  if (!Array.isArray(c.iconSets)) throw new Error('"iconSets" fehlt oder ist keine Liste.')
  for (const p of c.providers) {
    if (!p.id || !p.name || !Array.isArray(p.templates)) throw new Error(`Anbieter "${p.name ?? p.id ?? '?'}": id, name und templates sind nötig.`)
    for (const t of p.templates) {
      if (!t.id || !t.name || !t.url) throw new Error(`Vorlage in "${p.name}": id, name und url sind nötig.`)
      t.fields ??= []
    }
  }
  c.cacheHours = Number.isFinite(c.cacheHours) ? c.cacheHours : DEFAULT_CONFIG.cacheHours
  return c
}

/** The user's config; created from the defaults on first use so it can be edited. */
export async function loadConfig(): Promise<{ config: PickerConfig; error?: string }> {
  const text = await host.configRead(CONFIG_FILE).catch(() => null)
  if (text === null) {
    await host.configWrite(CONFIG_FILE, configText(DEFAULT_CONFIG)).catch(() => {})
    return { config: DEFAULT_CONFIG }
  }
  try {
    return { config: parseConfig(text) }
  } catch (e) {
    return { config: DEFAULT_CONFIG, error: `${CONFIG_FILE} ist fehlerhaft (${(e as Error).message}) – es werden die Standardwerte verwendet.` }
  }
}

export async function saveConfig(text: string): Promise<PickerConfig> {
  const config = parseConfig(text)
  await host.configWrite(CONFIG_FILE, text)
  return config
}

// ------------------------------------------------------------------ icon index

export interface IconEntry {
  title: string
  slug: string
  hex: string
  aliases: string[]
}

const indexes = new Map<string, IconEntry[]>()

/** Load (cached on disk) and normalize an icon set's index. */
export async function loadIcons(set: IconSet, cacheHours: number, force = false): Promise<IconEntry[]> {
  if (!force && indexes.has(set.id)) return indexes.get(set.id)!
  const raw = JSON.parse(await host.fetchCached(set.index, cacheHours, force)) as unknown
  const list = (Array.isArray(raw) ? raw : ((raw as { icons?: unknown[] }).icons ?? [])) as Record<string, unknown>[]
  const icons = list
    .filter((i) => typeof i.title === 'string')
    .map((i) => ({
      title: i.title as string,
      slug: (i.slug as string) || titleToSlug(i.title as string),
      hex: (i.hex as string) || '000000',
      aliases: aliasList(i.aliases),
    }))
  indexes.set(set.id, icons)
  return icons
}

function aliasList(a: unknown): string[] {
  if (!a || typeof a !== 'object') return []
  const o = a as { aka?: string[]; dup?: { title: string }[]; loc?: Record<string, string> }
  return [...(o.aka ?? []), ...(o.dup ?? []).map((d) => d.title), ...Object.values(o.loc ?? {})]
}

/** Simple Icons' slug rules (for index entries without an explicit slug). */
export function titleToSlug(title: string): string {
  const map: Record<string, string> = { '+': 'plus', '.': 'dot', '&': 'and', đ: 'd', ħ: 'h', ı: 'i', ĸ: 'k', ŀ: 'l', ł: 'l', ß: 'ss', ŧ: 't' }
  return title
    .toLowerCase()
    .replace(/[+.&đħıĸŀłßŧ]/g, (c) => map[c])
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '')
}

/** Ranked search: exact slug/title, prefix, then substring (title, slug, aliases). */
export function searchIcons(icons: IconEntry[], query: string, limit = 150): IconEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return icons.slice(0, limit)
  const scored: [number, IconEntry][] = []
  for (const i of icons) {
    const t = i.title.toLowerCase()
    let s = -1
    if (i.slug === q || t === q) s = 0
    else if (t.startsWith(q) || i.slug.startsWith(q)) s = 1
    else if (t.includes(q) || i.slug.includes(q)) s = 2
    else if (i.aliases.some((a) => a.toLowerCase().includes(q))) s = 3
    if (s >= 0) scored.push([s, i])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].title.length - b[1].title.length)
  return scored.slice(0, limit).map(([, i]) => i)
}
