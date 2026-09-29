import { describe, expect, it } from 'vitest'
import { highlightCode, language, loadHighlighter, tokensFromHtml } from '../src/editor/highlight'

describe('syntax highlighting', () => {
  it('turns highlight.js HTML into ranges of the plain text (entities count as one character)', () => {
    const html = '<span class="hljs-keyword">if</span> (a &lt; b &amp;&amp; <span class="hljs-string">&quot;x&quot;</span>) <span class="hljs-title function_">f</span>()'
    const text = 'if (a < b && "x") f()'
    const tokens = tokensFromHtml(html)
    expect(tokens.map((t) => [text.slice(t.from, t.to), t.cls])).toEqual([
      ['if', 'hljs-keyword'],
      ['"x"', 'hljs-string'],
      ['f', 'hljs-title function_'],
    ])
  })

  it('nested spans get the classes of all levels', () => {
    const tokens = tokensFromHtml('<span class="a">x<span class="b">y</span>z</span>')
    expect(tokens).toEqual([
      { from: 0, to: 1, cls: 'a' },
      { from: 1, to: 2, cls: 'a b' },
      { from: 2, to: 3, cls: 'a' },
    ])
  })

  it('highlights real code; ranges match the text', async () => {
    const h = await loadHighlighter()
    const code = 'const s = "a < b" // note\nfn main() {}'
    for (const lang of ['js', 'TypeScript', 'rust']) {
      const name = language(h, lang)!
      const tokens = highlightCode(h, name, code)
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.every((t) => t.to <= code.length && t.from < t.to)).toBe(true)
    }
    const js = highlightCode(h, 'javascript', code)
    expect(js.map((t) => code.slice(t.from, t.to))).toContain('"a < b"')
    expect(js.map((t) => code.slice(t.from, t.to))).toContain('// note')
  })

  it('knows aliases and the extra languages, ignores unknown ones', async () => {
    const h = await loadHighlighter()
    expect(language(h, 'sh')).toBe('sh')
    expect(language(h, 'powershell')).toBe('powershell')
    expect(language(h, 'Dockerfile')).toBe('dockerfile')
    expect(language(h, 'mermaid')).toBeNull()
    expect(language(h, null)).toBeNull()
  })
})
