// Release notes for a version, taken from the changelog in README.md.
//
//   node scripts/release-notes.mjs v0.2.0   → prints the notes (Markdown)
//
// Used by the release workflow; fails if the changelog has no section for the version.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8')

export function releaseNotes(markdown, version) {
  const v = version.replace(/^v/, '')
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^### ${v.replace(/\./g, '\\.')}(\\s|$)`).test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end).join('\n').trim()
  return `${body}

---

**Download:** \`Mark.O.Down_${v}_x64-setup.exe\` below – Windows 10/11, 64-bit.
The installer is not code-signed yet: if Windows SmartScreen shows *"Windows protected your PC"*,
click **More info → Run anyway**.
`
}

const version = process.argv[2]
if (version) {
  const notes = releaseNotes(readme, version)
  if (!notes) {
    console.error(`README.md hat keinen Changelog-Abschnitt "### ${version.replace(/^v/, '')}".`)
    process.exit(1)
  }
  process.stdout.write(notes)
}
