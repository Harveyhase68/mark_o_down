import { describe, expect, it } from 'vitest'
import { documentTitle, renderHtml, renderHtmlPage } from '../src/md/html'

describe('HTML export', () => {
  const md = '---\ntitle: x\n---\n\n<div align="center">\n\n# Mark O Down 😂\n\n</div>\n\n| A | B |\n|---|:-:|\n| **1** | 2 |\n\n- [x] done\n'

  it('renders GFM, keeps raw HTML, drops front matter', () => {
    const html = renderHtml(md)
    expect(html).toContain('<div align="center">')
    expect(html).toContain('<h1>Mark O Down 😂</h1>')
    expect(html).toContain('<td><strong>1</strong></td>')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('title: x')
  })

  it('builds a standalone page with the first heading as title', () => {
    expect(documentTitle(md, 'README')).toBe('Mark O Down 😂')
    expect(documentTitle('no heading', 'README')).toBe('README')
    const page = renderHtmlPage(md, 'Mark <O> Down')
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<meta charset="utf-8">')
    expect(page).toContain('<title>Mark &lt;O&gt; Down</title>')
    expect(page).toContain('<article class="markdown-body">')
  })
})

describe('HTML export with syntax highlighting', () => {
  it('colours code blocks with a known language, leaves others alone', async () => {
    const { loadHighlighter } = await import('../src/editor/highlight')
    const h = await loadHighlighter()
    const html = renderHtml('```js\nconst a = "x"\n```\n\n```\nplain < text\n```\n\n```nosuchlang\nx\n```\n', h)
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).toContain('<span class="hljs-string">&quot;x&quot;</span>')
    expect(html).toContain('<code>plain &#x3C; text\n</code>')
    expect(html).toContain('<code class="language-nosuchlang">x\n</code>')
    expect(renderHtml('```js\nconst a\n```\n')).not.toContain('hljs')
  })
})
