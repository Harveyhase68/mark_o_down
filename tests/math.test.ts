import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'

const S = schema.nodes
const reserialize = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta, { preserve: false })
}
const untouched = (md: string) => {
  const { doc, meta } = importMarkdown(md)
  return exportMarkdown(doc, meta)
}
const types = (doc: PMNode) => {
  const out: string[] = []
  doc.descendants((n) => void out.push(n.type.name))
  return out
}

describe('math', () => {
  const md = String.raw`Einstein: $E=mc^2$ and $\alpha + \beta$.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

` + '```math\n\sqrt{2}\n```\n'

  it('becomes formula nodes', () => {
    const { doc } = importMarkdown(md)
    const inline: string[] = []
    doc.descendants((n) => void (n.type === S.math_inline && inline.push(n.attrs.tex)))
    expect(inline).toEqual(['E=mc^2', String.raw`\alpha + \beta`])
    expect(doc.child(1).type).toBe(S.math_block)
    expect(doc.child(1).textContent).toBe(String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`)
    expect(doc.child(2).type).toBe(S.math_block)
    expect(doc.child(2).attrs.fence).toBe('`')
  })

  it('round-trips byte-for-byte, also fully re-serialized', () => {
    expect(untouched(md)).toBe(md)
    expect(reserialize(md)).toBe(md)
  })

  it('prices stay text (Pandoc rule), and are not escaped when edited', () => {
    for (const text of ['From $5 to $10.\n', 'Costs $5.\n', 'A $ x $ b\n', 'Range $5-$10\n']) {
      const { doc } = importMarkdown(text)
      expect(types(doc)).not.toContain('math_inline')
      expect(reserialize(text)).toBe(text)
    }
  })

  it('a single dollar next to a formula is escaped so it stays text', () => {
    const doc = S.doc.create(null, S.paragraph.create(null, [schema.text('Pay $3 for '), S.math_inline.create({ tex: 'x^2' })]))
    const out = exportMarkdown(doc)
    expect(out).toBe('Pay \$3 for $x^2$\n')
    const back = importMarkdown(out).doc
    expect(back.firstChild!.textContent.startsWith('Pay $3 for')).toBe(true)
    expect(types(back)).toContain('math_inline')
  })

  it('new formula blocks are written as $$', () => {
    const doc = S.doc.create(null, S.math_block.create(null, schema.text('a^2+b^2=c^2')))
    expect(exportMarkdown(doc)).toBe('$$\na^2+b^2=c^2\n$$\n')
  })
})

describe('couldFormMath (when $ must be escaped)', () => {
  it('follows the parser: prices no, formulas yes', async () => {
    const { couldFormMath } = await import('../src/md/toMdast')
    const { parseMarkdown } = await import('../src/md/markdown')
    const cases = ['From $5 to $10.', 'Costs $5.', 'A $ x $ b', '$5-$10', '$x$', 'a $x$5 $y$', '$a $ b$', '$$x$$', 'x $5 and $y$ z', 'no dollars']
    for (const text of cases) {
      let parsedAsMath = false
      const visit = (n: { type: string; children?: unknown[] }) => {
        if (n.type === 'inlineMath') parsedAsMath = true
        n.children?.forEach((c) => visit(c as never))
      }
      visit(parseMarkdown(text) as never)
      // may be cautious (escape more), never careless
      if (parsedAsMath) expect(couldFormMath(text), text).toBe(true)
    }
    expect(couldFormMath('From $5 to $10.')).toBe(false)
    expect(couldFormMath('Costs $5.')).toBe(false)
  })
})
