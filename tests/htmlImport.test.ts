import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../src/md/htmlImport'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { renderHtmlPage } from '../src/md/html'

const labels = (html: string) => htmlToMarkdown(html).losses.map((l) => `${l.label} ×${l.count}`)

describe('HTML import', () => {
  it('converts the Markdown-expressible parts', () => {
    const { markdown } = htmlToMarkdown(
      '<h1>Titel</h1><p>Text mit <b>fett</b>, <em>kursiv</em> und <a href="https://x.dev">Link</a>.<br>Neue Zeile</p>' +
        '<ul><li>eins</li><li>zwei</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' +
        '<pre><code>let x = 1;</code></pre>',
    )
    expect(markdown).toContain('# Titel')
    expect(markdown).toContain('**fett**')
    expect(markdown).toContain('*kursiv*')
    expect(markdown).toContain('[Link](https://x.dev)')
    expect(markdown).toContain('- eins')
    expect(markdown).toContain('| A | B |')
    expect(markdown).toContain('let x = 1;')
  })

  it('keeps <div align="center"> and sized <img> as HTML', () => {
    const { markdown, losses } = htmlToMarkdown('<div align="center"><img src="logo.png" width="120" alt="Logo" class="x"><h2>Projekt</h2></div>')
    expect(markdown).toMatch(/^<div align="center">\n\n<img src="logo.png" width="120" alt="Logo">\n\n## Projekt\n\n<\/div>\n$/)
    // …and the editor shows them as center block + image
    const { doc } = importMarkdown(markdown)
    expect(doc.firstChild!.type.name).toBe('center')
    expect(losses.map((l) => l.label)).toEqual(['CSS-Klassen (class="…")'])
  })

  it('reports what gets lost', () => {
    const l = labels(
      '<html><head><title>T</title><style>p{color:red}</style><script>x()</script></head>' +
        '<body><p style="color:red">Hallo <span class="a">Welt</span> <u>unterstrichen</u></p>' +
        '<div class="layout"><p>Inhalt</p></div><iframe src="https://y.dev"></iframe><!-- Notiz --></body></html>',
    )
    expect(l).toContain('Stylesheets (<style>) ×1')
    expect(l).toContain('Skripte (<script>) ×1')
    expect(l).toContain('Inline-Styles (style="…") ×1')
    expect(l).toContain('CSS-Klassen (class="…") ×2')
    expect(l).toContain('<span> – Formatierung geht verloren, Text bleibt ×1')
    expect(l).toContain('Unterstreichung (<u>) → kursiv ×1')
    expect(l).toContain('Layout-Container (<div>) – nur der Inhalt bleibt ×1')
    expect(l).toContain('Eingebettete Seiten (<iframe>) → nur Link ×1')
    expect(l).toContain('Kommentare (<!-- … -->) ×1')
  })

  it('embedded pages become links', () => {
    const r = htmlToMarkdown('<p>Video:</p><iframe src="https://y.dev/embed" width="560"></iframe><iframe src="https://z.dev" title="Karte"></iframe>')
    // each iframe becomes its own paragraph with a link (text = title, else the address)
    expect(r.markdown).toBe('Video:\n\n<https://y.dev/embed>\n\n[Karte](https://z.dev)\n')
    expect(r.losses.map((l) => l.label)).toEqual(['Eingebettete Seiten (<iframe>) → nur Link'])
  })

  it('a clean page reports no losses and keeps its title', () => {
    const r = htmlToMarkdown('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Seite</title></head><body><h1>Hi 😂</h1><p>Text</p></body></html>')
    expect(r.losses).toEqual([])
    expect(r.title).toBe('Seite')
    expect(r.markdown).toBe('# Hi 😂\n\nText\n')
  })

  it('our own HTML export imports back to the same Markdown', () => {
    const md = '# Mark O Down\n\n**Fett**, *kursiv* und [Link](https://predl.cc).\n\n- eins\n- zwei\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'
    const back = htmlToMarkdown(renderHtmlPage(md, 'Mark O Down'))
    expect(back.losses.filter((l) => !/Stylesheets|Attribute \(name|content/.test(l.label))).toEqual([])
    // semantically the same document (formatting of the Markdown may differ slightly)
    const norm = (s: string) => exportMarkdown(importMarkdown(s).doc, undefined, { preserve: false })
    expect(norm(back.markdown)).toBe(norm(md))
  })
})
