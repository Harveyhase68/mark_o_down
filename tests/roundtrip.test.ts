import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Transform } from 'prosemirror-transform'
import type { Node as PMNode } from 'prosemirror-model'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'
import { toHtml } from './html'

const dir = join(__dirname, 'fixtures')
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

const roundTrip = (md: string, preserve = true) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta, { preserve })
}

function findText(doc: PMNode, needle: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle)
    return found < 0
  })
  if (found < 0) throw new Error(`not found: ${needle}`)
  return found
}

describe.each(fixtures)('%s', (_name, md) => {
  it('import + export without edits is byte-identical', () => {
    expect(roundTrip(md)).toBe(md)
  })

  it('repeated import/export cycles are stable', () => {
    let text = md
    for (let i = 0; i < 3; i++) text = roundTrip(text)
    expect(text).toBe(md)
  })

  it('full re-serialization (no source reuse) renders identically', () => {
    const full = roundTrip(md, false)
    expect(toHtml(full)).toBe(toHtml(md))
  })

  it('full re-serialization is idempotent', () => {
    const once = roundTrip(md, false)
    expect(roundTrip(once, false)).toBe(once)
  })
})

describe('editing', () => {
  const md = fixtures.find(([n]) => n === 'kitchen-sink.md')![1]

  it('an edit changes only the edited block', () => {
    const { doc, meta } = importMarkdown(md)
    const pos = findText(doc, 'star item')
    const edited = new Transform(doc).insert(pos, schema.text('EDITED ')).doc
    const out = exportMarkdown(edited, meta)
    expect(out).toBe(md.replace('* star item', '* EDITED star item'))
    // …and it is stable afterwards
    expect(roundTrip(out)).toBe(out)
  })

  it('bold added in an edited paragraph survives a reload', () => {
    const { doc, meta } = importMarkdown('Hello world\n')
    const pos = findText(doc, 'world')
    const edited = new Transform(doc).addMark(pos, pos + 5, schema.marks.strong.create()).doc
    const out = exportMarkdown(edited, meta)
    expect(out).toBe('Hello **world**\n')
    expect(roundTrip(out)).toBe(out)
  })

  it('whitespace at mark edges is moved outside the markers', () => {
    const { doc, meta } = importMarkdown('Hello world\n')
    const pos = findText(doc, ' world')
    const edited = new Transform(doc).addMark(pos, pos + 6, schema.marks.strong.create()).doc
    expect(exportMarkdown(edited, meta)).toBe('Hello **world**\n')
  })

  it('overlapping bold/italic stays correct', () => {
    const { doc, meta } = importMarkdown('aaa bbb ccc\n')
    const a = findText(doc, 'aaa')
    const c = findText(doc, 'ccc')
    let tr = new Transform(doc).addMark(a, c - 1, schema.marks.strong.create())
    tr = tr.addMark(a + 4, c + 3, schema.marks.em.create())
    const out = exportMarkdown(tr.doc, meta)
    expect(toHtml(out)).toBe('<p><strong>aaa <em>bbb</em></strong><em> ccc</em></p>')
  })

  it('text that looks like Markdown is escaped', () => {
    const { doc, meta } = importMarkdown('x\n')
    const pos = findText(doc, 'x')
    const edited = new Transform(doc).insert(pos, schema.text('# not a heading *nor em* [nor link](x) ')).doc
    const out = exportMarkdown(edited, meta)
    expect(toHtml(out)).toBe('<p># not a heading *nor em* [nor link](x) x</p>')
  })

  it('4-byte unicode (emoji, ZWJ, flags, astral CJK) is preserved when edited', () => {
    const { doc, meta } = importMarkdown('Hi\n')
    const pos = findText(doc, 'Hi')
    const edited = new Transform(doc).insert(pos + 2, schema.text(' 😂👨‍👩‍👧‍👦🇦🇹𠜎𝕏')).doc
    expect(exportMarkdown(edited, meta)).toBe('Hi 😂👨‍👩‍👧‍👦🇦🇹𠜎𝕏\n')
  })

  it('editing a table cell keeps the compact table style', () => {
    const md = '| Aspect | Type |\n|---|---|\n| Web | prod |\n| `APP_ENV` | dev |\n'
    const { doc, meta } = importMarkdown(md)
    const pos = findText(doc, 'prod')
    const out = exportMarkdown(new Transform(doc).insert(pos + 4, schema.text('-like')).doc, meta)
    expect(out).toBe('| Aspect | Type |\n|---|---|\n| Web | prod-like |\n| `APP_ENV` | dev |\n')
  })

  it('a line break in a table cell becomes <br>', () => {
    const { doc, meta } = importMarkdown('| A |\n|---|\n| x |\n')
    const pos = findText(doc, 'x')
    const out = exportMarkdown(new Transform(doc).insert(pos + 1, [schema.nodes.hard_break.create(), schema.text('y')]).doc, meta)
    expect(out).toBe('| A |\n|---|\n| x<br>y |\n')
  })

  it('editing inside <div align="center"> keeps the tags and blank lines', () => {
    const md = 'Intro\n\n<div align="center">\n\n# Title\n\nText<br>\nmore\n\n</div>\n'
    const { doc, meta } = importMarkdown(md)
    expect(doc.child(1).type.name).toBe('center')
    const pos = findText(doc, 'Title')
    const out = exportMarkdown(new Transform(doc).insert(pos + 5, schema.text(' 😂')).doc, meta)
    expect(out).toBe(md.replace('# Title', '# Title 😂'))
  })

  it('an HTML <img> is an image; changing its src keeps width and the rest of the tag', () => {
    const md = '<a href="https://x.dev">\n  <img src="logo.png" width="120" alt="Logo">\n</a>\n'
    const { doc, meta } = importMarkdown(md)
    let imgPos = -1
    doc.descendants((n, p) => {
      if (n.type.name === 'image') imgPos = p
    })
    expect(imgPos).toBeGreaterThan(-1)
    const img = doc.nodeAt(imgPos)!
    const edited = new Transform(doc).setNodeMarkup(imgPos, null, { ...img.attrs, src: 'docs/new logo.png' }).doc
    expect(exportMarkdown(edited, meta)).toBe('<a href="https://x.dev">\n<img src="docs/new logo.png" width="120" alt="Logo">\n</a>\n')
  })

  it('& in badge URLs stays unescaped, real entity look-alikes are escaped', () => {
    const { doc, meta } = importMarkdown('x\n')
    const pos = findText(doc, 'x')
    const img = schema.nodes.image.create({ src: 'https://img.shields.io/badge/a-b-blue?style=flat&logo=rust', alt: 'AT&T' })
    const edited = new Transform(doc).insert(pos + 1, [schema.text(' &copy; '), img]).doc
    const out = exportMarkdown(edited, meta)
    expect(out).toBe('x \\&copy; ![AT&T](https://img.shields.io/badge/a-b-blue?style=flat&logo=rust)\n')
    expect(roundTrip(out)).toBe(out)
    expect(toHtml(out)).toContain('&#x26;copy;')
  })

  it('a new list next to an existing one does not merge with it', () => {
    const { doc, meta } = importMarkdown('- a\n')
    const list = schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('b'))))
    const edited = new Transform(doc).insert(doc.content.size, list).doc
    const out = exportMarkdown(edited, meta)
    expect(toHtml(out)).toBe('<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>')
  })
})
