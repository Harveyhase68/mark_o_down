import { describe, expect, it } from 'vitest'
import { applyFix, lintHtml } from '../src/md/htmlLint'

const summary = (md: string) => lintHtml(md).map((i) => `${i.kind} ${i.tag} @${i.line}`)
const fixAll = (md: string) => {
  let text = md
  for (let i = 0; i < 10; i++) {
    const issue = lintHtml(text).find((x) => x.fix)
    if (!issue) break
    text = applyFix(text, issue).text
  }
  return text
}

describe('HTML check under the source editor', () => {
  it('finds nothing in correct documents', () => {
    expect(summary('a <sup>2</sup> b<br>\n\n<div align="center">\n\n# Title\n\n</div>\n\n<details>\n<summary>x</summary>\n\ny\n\n</details>\n')).toEqual([])
    expect(summary('```html\n<div>\n```\n\n`<b>`\n')).toEqual([]) // code is not HTML
  })

  it('an unclosed inline tag: closed at the end of its paragraph', () => {
    const md = 'Text <sup>2 und\nweiter.\n\nNächster Absatz\n'
    expect(summary(md)).toEqual(['unclosed sup @1'])
    expect(fixAll(md)).toBe('Text <sup>2 und\nweiter.</sup>\n\nNächster Absatz\n')
  })

  it('a closing tag without opening tag: removed', () => {
    const md = 'Text</b> mehr\n'
    expect(summary(md)).toEqual(['stray b @1'])
    expect(fixAll(md)).toBe('Text mehr\n')
  })

  it('an unclosed block tag: closed at the end of the document', () => {
    const md = '<div align="center">\n\n# Titel\n\nText\n'
    expect(summary(md)).toEqual(['unclosed div @1'])
    expect(fixAll(md)).toBe('<div align="center">\n\n# Titel\n\nText\n\n</div>\n')
  })

  it('a comment without --> (it would hide the rest)', () => {
    const md = 'A\n\n<!-- Notiz\n\nB\n'
    expect(summary(md)).toEqual(['comment <!-- @3'])
    expect(fixAll(md)).toBe('A\n\n<!-- Notiz -->\n\nB\n')
  })

  it('tags whose end is optional in HTML are not reported; void tags neither', () => {
    expect(summary('<p>Absatz\n\n<img src="x.png">\n\n<table><tr><td>1\n</table>\n')).toEqual([])
  })

  it('nested: the inner tag left open is reported', () => {
    expect(summary('<b>fett <i>kursiv</b>\n')).toEqual(['unclosed i @1'])
  })
})
