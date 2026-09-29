// Markdown → HTML (GitHub-like), for "Export to HTML", "Copy HTML" and printing.
// Rendered from the exported Markdown, so the HTML always matches the saved file.
// Raw HTML in the document (`<div align="center">`, `<img width>` …) is kept.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml', 'toml']) // front matter is metadata, not content
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true })

/** HTML fragment of the document body. */
export function renderHtml(markdown: string): string {
  return String(processor.processSync(markdown)).trim()
}

/** Title for a standalone page: first heading, else the file name. */
export function documentTitle(markdown: string, fallback: string): string {
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(markdown) ?? /^(.+)\n(?:=+|-+)[ \t]*$/m.exec(markdown)
  const title = m?.[1].replace(/[*_`[\]!]|\(.*?\)|<[^>]+>/g, '').trim()
  return title || fallback
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Complete HTML page with an embedded GitHub-like stylesheet (no external files). */
export function renderHtmlPage(markdown: string, title: string, lang = 'de'): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Mark O Down">
<title>${escapeHtml(title)}</title>
<style>
${PAGE_CSS}
</style>
</head>
<body>
<article class="markdown-body">
${renderHtml(markdown)}
</article>
</body>
</html>
`
}

export const PAGE_CSS = `:root { color-scheme: light dark; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0; --bg: #ffffff; --soft: #f6f8fa; --link: #0969da; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f6fc; --muted: #9198a1; --border: #3d444d; --bg: #0d1117; --soft: #151b23; --link: #4493f8; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); }
.markdown-body { max-width: 900px; margin: 0 auto; padding: 32px 24px 64px; font: 16px/1.6 -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, "Noto Sans", Helvetica, Arial, sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"; word-wrap: break-word; }
.markdown-body > :first-child { margin-top: 0 !important; }
.markdown-body p, .markdown-body blockquote, .markdown-body ul, .markdown-body ol, .markdown-body dl, .markdown-body table, .markdown-body pre, .markdown-body details { margin: 0 0 16px; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
.markdown-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { font-size: 1.25em; } .markdown-body h4 { font-size: 1em; } .markdown-body h5 { font-size: .875em; } .markdown-body h6 { font-size: .85em; color: var(--muted); }
.markdown-body a { color: var(--link); text-decoration: none; } .markdown-body a:hover { text-decoration: underline; }
.markdown-body img { max-width: 100%; vertical-align: middle; box-sizing: content-box; }
.markdown-body hr { height: .25em; margin: 24px 0; padding: 0; border: 0; background: var(--border); }
.markdown-body blockquote { padding: 0 1em; color: var(--muted); border-left: .25em solid var(--border); }
.markdown-body ul, .markdown-body ol { padding-left: 2em; } .markdown-body li + li { margin-top: .25em; }
.markdown-body li.task-list-item { list-style: none; } .markdown-body li.task-list-item input { margin: 0 .3em .2em -1.4em; vertical-align: middle; }
.markdown-body code, .markdown-body tt { padding: .2em .4em; font: 85%/1.45 ui-monospace, "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; background: var(--soft); border-radius: 6px; }
.markdown-body pre { padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; background: var(--soft); border-radius: 6px; }
.markdown-body pre code { padding: 0; font-size: 100%; background: none; white-space: pre; }
.markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; border-spacing: 0; border-collapse: collapse; }
.markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid var(--border); }
.markdown-body th { font-weight: 600; } .markdown-body tr:nth-child(2n) { background: var(--soft); }
.markdown-body .footnotes { font-size: 12px; color: var(--muted); border-top: 1px solid var(--border); }
.markdown-body [align="center"] { text-align: center; }
.markdown-body [align="center"] > table { margin-left: auto; margin-right: auto; }
@media print {
  :root { --fg: #000; --muted: #444; --bg: #fff; --soft: #f3f3f3; --link: #000; color-scheme: light; }
  .markdown-body { max-width: none; padding: 0; }
  .markdown-body pre, .markdown-body table, .markdown-body img, .markdown-body blockquote { break-inside: avoid; }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
  .markdown-body pre { white-space: pre-wrap; }
}`
