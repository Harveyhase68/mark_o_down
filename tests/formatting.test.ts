import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'

const S = schema.nodes
const K = schema.marks

/** Import, let `edit` change the document, export again (edited blocks are re-serialized). */
function edited(md: string, edit: (doc: PMNode) => PMNode) {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(edit(doc), meta)
}

/** Full re-serialization: what an edited block turns into. */
const reserialize = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta, { preserve: false })
}

const nodesOf = (doc: PMNode, type: string) => {
  const out: PMNode[] = []
  doc.descendants((n) => void (n.type.name === type && out.push(n)))
  return out
}

describe('footnotes', () => {
  const md = 'Text with a note[^1] and another[^note].\n\n[^1]: The first note.\n\n[^note]: Second, with **bold**\n    and a second line.\n'

  it('become footnote nodes', () => {
    const { doc } = importMarkdown(md)
    expect(nodesOf(doc, 'footnote_ref').map((n) => n.attrs.label)).toEqual(['1', 'note'])
    const defs = nodesOf(doc, 'footnote_def')
    expect(defs.map((n) => n.attrs.label)).toEqual(['1', 'note'])
    expect(defs[0].textContent).toBe('The first note.')
    expect(nodesOf(doc, 'raw_block')).toHaveLength(0)
  })

  it('round-trip byte-for-byte, also fully re-serialized', () => {
    expect(edited(md, (d) => d)).toBe(md)
    expect(reserialize(md)).toBe(md)
  })

  it('a reference without definition stays text (like on GitHub)', () => {
    const { doc } = importMarkdown('Just [^x] text.\n')
    expect(nodesOf(doc, 'footnote_ref')).toHaveLength(0)
    expect(edited('Just [^x] text.\n', (d) => d)).toBe('Just [^x] text.\n')
  })

  it('new footnotes serialize as GFM', () => {
    const doc = S.doc.create(null, [
      S.paragraph.create(null, [schema.text('Fact'), S.footnote_ref.create({ label: '1' })]),
      S.footnote_def.create({ label: '1' }, S.paragraph.create(null, schema.text('Source.'))),
    ])
    expect(exportMarkdown(doc)).toBe('Fact[^1]\n\n[^1]: Source.\n')
  })
})

describe('<sup>, <sub>, <mark>', () => {
  it('become formatting and keep their tags', () => {
    const md = 'E = mc<sup>2</sup>, H<sub>x</sub>O and <mark>important</mark>.\n'
    const { doc } = importMarkdown(md)
    const marks = (text: string) => {
      let names: string[] = []
      doc.descendants((n) => void (n.isText && n.text === text && (names = n.marks.map((m) => m.type.name))))
      return names
    }
    expect(marks('2')).toEqual(['sup'])
    expect(marks('important')).toEqual(['highlight'])
    expect(nodesOf(doc, 'raw_inline')).toHaveLength(0)
    expect(reserialize(md)).toBe(md)
  })

  it('keeps attributes and case of the original tags', () => {
    const md = 'x<SUP class="a">n</SUP> and <mark style="color:red">y</mark>\n'
    expect(reserialize(md)).toBe(md)
  })

  it('works inside and around other formatting', () => {
    const md = '**x<sup>2</sup>** and *<sub>i</sub>* and [a<sup>b</sup>](https://x.dev)\n'
    expect(reserialize(md)).toBe(md)
  })

  it('an unclosed tag stays raw HTML', () => {
    const md = 'a <sup>b\n'
    const { doc } = importMarkdown(md)
    expect(nodesOf(doc, 'raw_inline')).toHaveLength(1)
    expect(reserialize(md)).toBe(md)
  })

  it('new formatting is written as plain tags', () => {
    const doc = S.doc.create(null, S.paragraph.create(null, [schema.text('x'), schema.text('2', [K.sup.create()]), schema.text(' '), schema.text('hi', [K.highlight.create()])]))
    expect(exportMarkdown(doc)).toBe('x<sup>2</sup> <mark>hi</mark>\n')
  })

  it('superscript and subscript exclude each other', () => {
    expect(K.sup.create().addToSet([K.sub.create()]).map((m) => m.type.name)).toEqual(['sup'])
  })
})
