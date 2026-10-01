// Markdown → HTML (GitHub-like), for "Export to HTML", "Copy HTML" and printing.
// Rendered from the exported Markdown, so the HTML always matches the saved file.
// Raw HTML in the document (`<div align="center">`, `<img width>` …) is kept.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import type { Element, Root as HRoot } from 'hast'
import type { HLJSApi } from 'highlight.js'
import { extendedSyntaxOn, markdownPlugins } from './markdown'
import { defListHastHandlers } from 'mdast-util-definition-list'
import type { MathRenderer } from './mathRender'

export interface RenderOptions {
  /** Colour fenced code blocks (classes as on GitHub, see PAGE_CSS). */
  highlight?: HLJSApi
  /** Show `$…$` / `$$…$$` / ```math as formulas (MathML). */
  math?: MathRenderer
}

const text = (el: Element) => el.children.map((c) => (c.type === 'text' ? c.value : '')).join('')
const classes = (el: Element | undefined) => (el?.type === 'element' ? ((el.properties.className as string[] | undefined) ?? []) : [])
const raw = (value: string) => ({ type: 'raw', value }) as unknown as Element

/** Code blocks → coloured, math (mdast-util-math marks it as `code.math-inline` / `pre > code.math-display`) → MathML. */
function rehypeCodeAndMath(opts: RenderOptions) {
  return (tree: HRoot) => {
    const visit = (node: HRoot | Element) => {
      node.children.forEach((child, i) => {
        if (child.type !== 'element') return
        const code = child.tagName === 'pre' ? (child.children[0] as Element | undefined) : undefined
        const cls = classes(code)
        if (code?.tagName === 'code' && (cls.includes('math-display') || cls.includes('language-math'))) {
          if (opts.math) node.children[i] = raw(opts.math.render(text(code).replace(/\n$/, ''), true))
          return
        }
        if (child.tagName === 'code' && classes(child).includes('math-inline')) {
          if (opts.math) node.children[i] = raw(opts.math.render(text(child), false))
          return
        }
        const lang = cls.find((c) => c.startsWith('language-'))?.slice(9).toLowerCase()
        if (code?.tagName === 'code' && lang && opts.highlight?.getLanguage(lang)) {
          code.children = [raw(opts.highlight.highlight(text(code), { language: lang, ignoreIllegals: true }).value)]
          return
        }
        visit(child)
      })
    }
    visit(tree)
  }
}

// the same Markdown dialect as the editor (GFM, math, front matter, extended syntax if on)
const processor = (opts: RenderOptions = {}) =>
  unified()
    .use(remarkParse)
    .use(markdownPlugins()) // front matter is metadata, not content
    .use(remarkRehype, { allowDangerousHtml: true, handlers: defListHastHandlers as never })
    .use(rehypeCodeAndMath, opts)
    .use(rehypeStringify, { allowDangerousHtml: true })
const plain = new Map<boolean, ReturnType<typeof processor>>()

/** HTML fragment of the document body. */
export function renderHtml(markdown: string, opts?: RenderOptions): string {
  let p = plain.get(extendedSyntaxOn())
  if (!p) plain.set(extendedSyntaxOn(), (p = processor()))
  return String((opts?.highlight || opts?.math ? processor(opts) : p).processSync(markdown)).trim()
}

/** Title for a standalone page: first heading, else the file name. */
export function documentTitle(markdown: string, fallback: string): string {
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(markdown) ?? /^(.+)\n(?:=+|-+)[ \t]*$/m.exec(markdown)
  const title = m?.[1].replace(/[*_`[\]!]|\(.*?\)|<[^>]+>/g, '').trim()
  return title || fallback
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Complete HTML page with an embedded GitHub-like stylesheet (no external files). */
export function renderHtmlPage(markdown: string, title: string, lang = 'de', opts: RenderOptions = {}): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Mark O Down">
<title>${escapeHtml(title)}</title>
<style>
${PAGE_CSS}${opts.math ? `\n${opts.math.css}` : ''}
</style>
</head>
<body>
<article class="markdown-body">
${renderHtml(markdown, opts)}
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
/* code colours like GitHub */
.hljs-keyword, .hljs-doctag, .hljs-template-tag, .hljs-variable.language_, .hljs-meta .hljs-keyword { color: var(--hl-keyword); }
.hljs-title, .hljs-title.class_, .hljs-title.function_ { color: var(--hl-title); }
.hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-variable, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-section { color: var(--hl-constant); }
.hljs-regexp, .hljs-string, .hljs-meta .hljs-string { color: var(--hl-string); }
.hljs-built_in, .hljs-symbol, .hljs-type { color: var(--hl-builtin); }
.hljs-comment, .hljs-code, .hljs-formula { color: var(--hl-comment); }
.hljs-name, .hljs-quote, .hljs-selector-tag, .hljs-selector-pseudo, .hljs-tag { color: var(--hl-tag); }
.hljs-bullet { color: var(--hl-bullet); } .hljs-emphasis { font-style: italic; } .hljs-strong, .hljs-section { font-weight: 600; }
.hljs-addition { color: var(--hl-tag); background: var(--hl-add-bg); } .hljs-deletion { color: var(--hl-keyword); background: var(--hl-del-bg); }
:root { --hl-keyword: #cf222e; --hl-title: #8250df; --hl-constant: #0550ae; --hl-string: #0a3069; --hl-builtin: #953800; --hl-comment: #59636e; --hl-tag: #116329; --hl-bullet: #3b2300; --hl-add-bg: #dafbe1; --hl-del-bg: #ffebe9; }
@media (prefers-color-scheme: dark) { :root { --hl-keyword: #ff7b72; --hl-title: #d2a8ff; --hl-constant: #79c0ff; --hl-string: #a5d6ff; --hl-builtin: #ffa657; --hl-comment: #9198a1; --hl-tag: #7ee787; --hl-bullet: #f2cc60; --hl-add-bg: #033a16; --hl-del-bg: #67060c; } }
.markdown-body mark { padding: 0 .1em; background: #fff8c5; color: inherit; }
.markdown-body dl { padding: 0; } .markdown-body dl dt { margin-top: 16px; font-style: italic; font-weight: 600; } .markdown-body dl dd { margin: 0 0 16px; padding: 0 16px; }
@media print {
  :root { --fg: #000; --muted: #444; --bg: #fff; --soft: #f3f3f3; --link: #000; color-scheme: light; --hl-keyword: #cf222e; --hl-title: #8250df; --hl-constant: #0550ae; --hl-string: #0a3069; --hl-builtin: #953800; --hl-comment: #59636e; --hl-tag: #116329; --hl-bullet: #3b2300; --hl-add-bg: #dafbe1; --hl-del-bg: #ffebe9; }
  .markdown-body { max-width: none; padding: 0; }
  .markdown-body pre, .markdown-body table, .markdown-body img, .markdown-body blockquote { break-inside: avoid; }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
  .markdown-body pre { white-space: pre-wrap; }
}`
