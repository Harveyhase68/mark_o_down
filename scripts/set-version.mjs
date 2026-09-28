// Keeps the app version identical everywhere.
//
//   node scripts/set-version.mjs 0.2.0        set the version in all files
//   node scripts/set-version.mjs --check v0.2.0   verify all files match (used by the release workflow)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = (p) => join(root, p)
const read = (p) => readFileSync(file(p), 'utf8')

const FILES = {
  'package.json': {
    get: (t) => JSON.parse(t).version,
    set: (t, v) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
  'package-lock.json': {
    // the project itself: top-level "version" and packages[""].version
    get: (t) => JSON.parse(t).version,
    set: (t, v) => {
      const j = JSON.parse(t)
      j.version = v
      if (j.packages?.['']) j.packages[''].version = v
      return JSON.stringify(j, null, 2) + '\n'
    },
  },
  'src-tauri/Cargo.toml': {
    get: (t) => /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(t)?.[1],
    set: (t, v) => t.replace(/^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${v}$2`),
  },
  'src-tauri/Cargo.lock': {
    get: (t) => /name = "mark_o_down"\r?\nversion = "([^"]+)"/.exec(t)?.[1],
    set: (t, v) => t.replace(/(name = "mark_o_down"\r?\nversion = ")[^"]+(")/, `$1${v}$2`),
  },
  'src-tauri/tauri.conf.json': {
    get: (t) => JSON.parse(t).version,
    set: (t, v) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const args = process.argv.slice(2)
const check = args[0] === '--check'
const version = (check ? args[1] : args[0])?.replace(/^v/, '')

if (!version || !SEMVER.test(version)) {
  console.error('Aufruf: node scripts/set-version.mjs <x.y.z>   oder   --check <vx.y.z>')
  process.exit(2)
}

if (check) {
  const wrong = Object.entries(FILES)
    .map(([p, f]) => [p, f.get(read(p))])
    .filter(([, v]) => v !== version)
  if (wrong.length) {
    for (const [p, v] of wrong) console.error(`✗ ${p}: ${v} (erwartet ${version})`)
    console.error(`\nVersion vor dem Taggen setzen:  npm run release:version ${version}`)
    process.exit(1)
  }
  console.log(`✓ Version ${version} in allen Dateien`)
} else {
  for (const [p, f] of Object.entries(FILES)) {
    const before = read(p)
    const after = f.set(before, version)
    if (f.get(after) !== version) throw new Error(`${p}: Version konnte nicht gesetzt werden`)
    writeFileSync(file(p), after)
    console.log(`${p}: ${f.get(before)} → ${version}`)
  }
  console.log(`\nJetzt committen, taggen und pushen:
  git commit -am "Release v${version}"
  git tag v${version}
  git push origin main v${version}`)
}
