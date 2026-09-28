// Real-world corpus: every README in node_modules must round-trip.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { toHtml } from './html'

function readmes(dir: string, out: string[] = [], depth = 0): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (/^readme\.md$/i.test(name)) out.push(p)
    else if (depth < 3 && !name.startsWith('.') && statSync(p).isDirectory()) readmes(p, out, depth + 1)
  }
  return out
}

const files = readmes(join(__dirname, '..', 'node_modules'))

describe(`corpus (${files.length} READMEs)`, () => {
  it.each(files)('%s', (file) => {
    const md = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const { doc, meta } = importMarkdown(md)
    expect(exportMarkdown(doc, meta)).toBe(md)
    const full = exportMarkdown(doc, meta, { preserve: false })
    expect(toHtml(full)).toBe(toHtml(md))
  })
})
