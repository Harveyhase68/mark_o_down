// Writes public/third-party-licenses.txt: the licenses of everything shipped in
// the app – npm packages bundled into the frontend, Rust crates compiled into the
// program, and the Unicode/CLDR data behind the emoji picker. Identical license
// texts are listed once with all components that use them.
//
//   node scripts/third-party-licenses.mjs            (part of `npm run build`)
//   node scripts/third-party-licenses.mjs --if-missing (npm run dev: only if there is none yet;
//                                                    a missing Rust toolchain is no error)
//
// The file is generated, not committed (see .gitignore).

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public', 'third-party-licenses.txt')
const optional = process.argv.includes('--if-missing')
if (optional && existsSync(OUT)) process.exit(0)

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i

// The Apache License 2.0 is long and the same everywhere: it is printed once at the
// end; a package's copy is replaced by a reference (plus its own copyright lines, if
// it filled in the appendix).
let apacheText = null
const APACHE_REF = 'Apache License 2.0 – full text: see "Apache License, Version 2.0" at the end of this file.'

function shortenApache(text) {
  if (!/Apache License\s+Version 2\.0, January 2004/.test(text) || !/END OF TERMS AND CONDITIONS/.test(text)) return text
  const [terms, appendix = ''] = text.split(/END OF TERMS AND CONDITIONS/)
  apacheText ??= (terms + 'END OF TERMS AND CONDITIONS').trim()
  const own = appendix
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /copyright/i.test(l) && !/\[yyyy\]|\{yyyy\}|\[name of copyright owner\]|\{name of copyright owner\}/i.test(l))
  return [APACHE_REF, ...own].join('\n')
}

/** All license/notice files of a package folder, in a stable order. */
function licenseTexts(dir, explicit) {
  const files = explicit ? [explicit] : existsSync(dir) ? readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort() : []
  return files
    .map((f) => join(dir, f))
    .filter((p) => existsSync(p))
    .map((p) => shortenApache(readFileSync(p, 'utf8').replace(/\r\n?/g, '\n').trim()))
    .filter(Boolean)
}

const run = (command) => execSync(command, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

// ------------------------------------------------------------------ npm (production dependencies only)

function npmPackages() {
  // exits non-zero for harmless reasons (e.g. extraneous packages); the output is still complete
  let out
  try {
    out = run('npm ls --omit=dev --all --parseable')
  } catch (e) {
    out = e.stdout ?? ''
  }
  const dirs = [...new Set(out.split(/\r?\n/).filter(Boolean))].filter((d) => d !== root)
  const pkgs = []
  for (const dir of dirs) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const p = JSON.parse(readFileSync(manifest, 'utf8'))
    pkgs.push({ name: p.name, version: p.version, license: typeof p.license === 'string' ? p.license : (p.license?.type ?? ''), texts: licenseTexts(dir), kind: 'npm' })
  }
  return pkgs
}

// ------------------------------------------------------------------ Rust (crates linked into the program)

function rustCrates() {
  let meta
  try {
    // only the crates for the platform being built (the release builds each platform on its own machine)
    const host = /^host: (.+)$/m.exec(run('rustc -vV'))[1].trim()
    meta = JSON.parse(run(`cargo metadata --format-version 1 --filter-platform ${host} --manifest-path "${join('src-tauri', 'Cargo.toml')}"`))
  } catch (e) {
    if (optional) {
      console.warn('third-party-licenses: cargo not available – Rust crates left out')
      return []
    }
    throw e
  }
  const byId = new Map(meta.packages.map((p) => [p.id, p]))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  // normal dependencies of the app, transitively; build scripts and tests are not shipped
  const seen = new Set()
  const queue = [meta.resolve.root]
  while (queue.length) {
    const id = queue.pop()
    for (const d of nodes.get(id)?.deps ?? []) {
      if (!d.dep_kinds.some((k) => k.kind === null) || seen.has(d.pkg)) continue
      seen.add(d.pkg)
      queue.push(d.pkg)
    }
  }
  return [...seen].map((id) => {
    const p = byId.get(id)
    const dir = dirname(p.manifest_path)
    return { name: p.name, version: p.version, license: p.license ?? '', texts: licenseTexts(dir, p.license_file ?? undefined), kind: 'crate' }
  })
}

// ------------------------------------------------------------------ data

const UNICODE_DATA = {
  name: 'Unicode Character Database and CLDR annotations (emoji and symbol names, keywords)',
  version: '',
  license: 'Unicode-3.0',
  kind: 'data',
  texts: [
    `UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.`,
  ],
}

// ------------------------------------------------------------------ output

const components = [...npmPackages(), ...rustCrates(), UNICODE_DATA]
const label = (c) => `${c.name}${c.version ? ' ' + c.version : ''}${c.kind === 'crate' ? ' (Rust)' : ''}`

// group components by license text (line breaks and indentation don't make a license different)
const groups = new Map()
for (const c of components) {
  const text = c.texts.length
    ? c.texts.join('\n\n- - -\n\n')
    : `License: ${c.license || 'see the package'} – the package ships no license file; the standard text is at https://spdx.org/licenses/`
  const key = text.replace(/\s+/g, ' ')
  const g = groups.get(key) ?? { text, names: [] }
  g.names.push(label(c))
  groups.set(key, g)
}
const sorted = [...groups.values()]
  .map((g) => ({ ...g, names: [...new Set(g.names)].sort((a, b) => a.localeCompare(b)) }))
  .sort((a, b) => b.names.length - a.names.length || a.names[0].localeCompare(b.names[0]))

const RULE = '='.repeat(78)
let out = `Mark O Down – third-party licenses

Mark O Down is free software (MIT License, © 2026 Alexander Predl). It is built
with the open-source components listed below; their licenses follow. Components
under the same license text are listed together.

${components.length} components: ${components.filter((c) => c.kind === 'npm').length} npm packages, ${components.filter((c) => c.kind === 'crate').length} Rust crates, Unicode data.
`
for (const g of sorted) out += `\n${RULE}\n${g.names.join(', ')}\n${RULE}\n\n${g.text}\n`
if (apacheText) out += `\n${RULE}\nApache License, Version 2.0\n${RULE}\n\n${apacheText}\n`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out)
console.log(`third-party-licenses: ${components.length} components, ${sorted.length} license texts, ${(out.length / 1024).toFixed(0)} KB → public/third-party-licenses.txt`)
