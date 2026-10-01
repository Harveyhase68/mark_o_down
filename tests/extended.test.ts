import { afterEach, describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'
import { setExtendedSyntax } from '../src/md/markdown'
import { renderHtml } from '../src/md/html'

const S = schema.nodes
const K = schema.marks
const untouched = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta)
}
const reserialize = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta, { preserve: false })
}
/** text → names of its marks */
const marksOf = (doc: PMNode) => {
  const out: Record<string, string[]> = {}
  doc.descendants((n) => void (n.isText && (out[n.text!] = n.marks.map((m) => m.type.name))))
  return out
}

afterEach(() => setExtendedSyntax(true))

describe('extended syntax (on)', () => {
  it('^sup^, ~sub~, ==mark== become formatting and stay as written', () => {
    const md = 'H~2~O und mc^3^ – ==Dieser Text sollte hervorgehoben sein.== und ~~durch~~.\n'
    const m = marksOf(importMarkdown(md).doc)
    expect(m['2']).toEqual(['sub'])
    expect(m['3']).toEqual(['sup'])
    expect(m['Dieser Text sollte hervorgehoben sein.']).toEqual(['highlight'])
    expect(m['durch']).toEqual(['strike'])
    expect(untouched(md)).toBe(md)
    expect(reserialize(md)).toBe(md)
  })

  it('Pandoc rule: no spaces in ^…^ / ~…~; ==…== may have them', () => {
    const md = 'a ^b c^ d ~e f~ g ==h i== 2^10 and ~/path\n'
    const m = marksOf(importMarkdown(md).doc)
    expect(Object.values(m).flat()).toEqual(['highlight'])
    // none of these can form a span, so nothing needs escaping
    expect(reserialize(md)).toBe(md)
  })

  it('a lone ^ or ~ is not escaped when its paragraph is edited', () => {
    for (const md of ['2^10 is 1024\n', 'about ~5 minutes\n', 'a == b\n']) expect(reserialize(md)).toBe(md)
  })

  it('works with other formatting inside and around', () => {
    const md = '**x^2^** and ==*wichtig* **sehr**== and ^*e*^\n'
    expect(reserialize(md)).toBe(md)
  })

  it('definition lists', () => {
    const md = 'Markdown\n: Eine leichtgewichtige Auszeichnungssprache.\n\nHTML\n: Hypertext Markup Language.\n'
    const { doc } = importMarkdown(md)
    expect(doc.childCount).toBe(1)
    expect(doc.firstChild!.type).toBe(S.def_list)
    expect(doc.firstChild!.content.content.map((n) => `${n.type.name}:${n.textContent}`)).toEqual([
      'def_term:Markdown',
      'def_desc:Eine leichtgewichtige Auszeichnungssprache.',
      'def_term:HTML',
      'def_desc:Hypertext Markup Language.',
    ])
    expect(untouched(md)).toBe(md)
    expect(renderHtml(md).replace(/\n<\/dd>/g, '</dd>')).toBe('<dl>\n<dt>Markdown</dt>\n<dd>Eine leichtgewichtige Auszeichnungssprache.</dd>\n<dt>HTML</dt>\n<dd>Hypertext Markup Language.</dd>\n</dl>')
  })

  it('renders <sup>/<sub>/<mark> in the HTML export', () => {
    expect(renderHtml('H~2~O, x^2^, ==hi==')).toBe('<p>H<sub>2</sub>O, x<sup>2</sup>, <mark>hi</mark></p>')
  })

  it('new formatting is written in the short form – with spaces as HTML tag', () => {
    const doc = S.doc.create(
      null,
      S.paragraph.create(null, [
        schema.text('x'),
        schema.text('2', [K.sup.create({ md: true })]),
        schema.text(' H'),
        schema.text('a b', [K.sub.create({ md: true })]),
        schema.text(' '),
        schema.text('hi there', [K.highlight.create({ md: true })]),
      ]),
    )
    expect(exportMarkdown(doc)).toBe('x^2^ H<sub>a b</sub> ==hi there==\n')
  })
})

describe('extended syntax (off = like GitHub)', () => {
  it('~x~ is strikethrough again, the rest is text', () => {
    setExtendedSyntax(false)
    const md = 'H~2~O und mc^2^ und ==x==\n\nTerm\n: Def\n'
    const { doc } = importMarkdown(md)
    expect(marksOf(doc)['2']).toEqual(['strike'])
    expect(doc.childCount).toBe(2)
    expect(doc.lastChild!.type).toBe(S.paragraph)
    expect(untouched(md)).toBe(md)
    expect(renderHtml('==x== ^y^')).toBe('<p>==x== ^y^</p>')
  })
})

describe('definition lists: writing', () => {
  it('new and edited definitions are written as ": Text", continuation lines indented', () => {
    const doc = S.doc.create(null, S.def_list.create(null, [
      S.def_term.create(null, schema.text('Begriff')),
      S.def_desc.create(null, [S.paragraph.create(null, schema.text('Erster Absatz')), S.paragraph.create(null, schema.text('Zweiter Absatz'))]),
      S.def_term.create(null, schema.text('Noch einer')),
      S.def_desc.create(null, S.paragraph.create(null, schema.text('Kurz.'))),
    ]))
    const md = exportMarkdown(doc)
    expect(md).toBe('Begriff\n: Erster Absatz\n\n  Zweiter Absatz\n\nNoch einer\n: Kurz.\n')
    // and reads back the same
    expect(exportMarkdown(importMarkdown(md).doc, undefined, { preserve: false })).toBe(md)
    expect(importMarkdown(md).doc.firstChild!.childCount).toBe(4)
  })
})

describe('definition list as the last block', () => {
  it('a block added after it gets one blank line and the final newline stays', () => {
    const md = 'Begriff\n: Erklärung\n'
    const { doc, meta } = importMarkdown(md)
    expect(meta.trail).toBe('\n')
    const after = doc.copy(doc.content.append(S.doc.create(null, S.paragraph.create(null, schema.text('Danach'))).content))
    expect(exportMarkdown(after, meta)).toBe('Begriff\n: Erklärung\n\nDanach\n')
  })
})

describe('mermaid', () => {
  const md = 'Text\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n~~~mermaid\ngraph TD\n  X --> Y\n~~~\n'

  it('```mermaid blocks become diagram blocks and round-trip', () => {
    const { doc } = importMarkdown(md)
    expect(doc.child(1).type).toBe(S.mermaid_block)
    expect(doc.child(1).textContent).toBe('flowchart LR\n  A --> B')
    expect(doc.child(2).attrs.fence).toBe('~')
    expect(untouched(md)).toBe(md)
    expect(reserialize(md)).toBe(md)
  })

  it('the HTML export puts in the drawn SVG; without it the code stays', () => {
    const mermaid = new Map([['flowchart LR\n  A --> B', '<svg id="d1"></svg>']])
    const html = renderHtml(md, { mermaid })
    expect(html).toContain('<div class="mermaid"><svg id="d1"></svg></div>')
    expect(html).toContain('<code class="language-mermaid">graph TD')
    expect(renderHtml(md)).not.toContain('<svg')
  })
})
