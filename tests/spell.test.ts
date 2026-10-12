import { describe, expect, it } from 'vitest'
import { importMarkdown } from '../src/md/document'
import { eachWord } from '../src/editor/spell'

const words = (md: string) => {
  const { doc } = importMarkdown(md)
  const out: string[] = []
  eachWord(doc, (w, from, to) => {
    expect(doc.textBetween(from, to)).toBe(w) // positions are right
    out.push(w)
  })
  return out
}

describe('spell checking: which words are checked', () => {
  it('prose, also inside formatting and links', () => {
    expect(words('Ein **fehlerhafter** Satz mit [Lenk](https://x.dev) und Äpfeln.\n')).toEqual(['Ein', 'fehlerhafter', 'Satz', 'mit', 'Lenk', 'und', 'Äpfeln'])
  })

  it('not: code, URLs, paths, file names, e-mail, digits, CamelCase, ALLCAPS, single letters', () => {
    expect(words('Siehe `config.ts`, https://x.dev/pfad, C:\\Temp, README.md, a@b.cc, v2, H2O, GitHub, iPhone, HTML, x und gut\n')).toEqual(['Siehe', 'und', 'gut'])
  })

  it('not: code blocks, formulas, diagrams, raw HTML, front matter', () => {
    expect(words('---\ntitel: Fehlr\n---\n\n```\nFehlr\n```\n\n$$\nFehlr\n$$\n\n<div>Fehlr</div>\n\nNur dies\n')).toEqual(['Nur', 'dies'])
  })

  it('apostrophes belong to the word', () => {
    expect(words("Don't geht's\n")).toEqual(["Don't", "geht's"])
  })
})
