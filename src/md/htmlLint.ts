// Checks the HTML in a Markdown document for tags that are not closed (or closed
// without being opened) and comments without `-->`. Shown under the source editor,
// each with a fix the user can apply – nothing is changed without asking.
//
// The visual editor copes with broken HTML (it stays raw text and is saved as it
// is), but the result on GitHub may not be what was meant: an unclosed `<!--`
// hides the rest of the document, an unclosed `<div>` swallows what follows.

import type { Nodes, Parent, RootContent } from 'mdast'
import { parseMarkdown } from './markdown'

export interface LintIssue {
  kind: 'unclosed' | 'stray' | 'comment'
  tag: string
  line: number
  /** offset of the tag in the text */
  offset: number
  /** a fix: insert `insert` at `at`, or remove `remove` */
  fix?: { at: number; insert: string } | { remove: [number, number] }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
// closing tag optional in HTML: not reported when missing
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option', 'optgroup', 'colgroup', 'caption', 'rt', 'rp', 'html', 'head', 'body'])

const TAG = /<!--[^]*?(?:-->|$)|<\/?([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g

interface Open {
  tag: string
  offset: number
  line: number
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length

export function lintHtml(text: string): LintIssue[] {
  const issues: LintIssue[] = []
  const tree = parseMarkdown(text)
  /** block-level tags (`<div align="center">` … `</div>` across blocks) */
  const blockStack: Open[] = []

  /** Tags of one html node, matched against `stack`. */
  const scan = (value: string, start: number, stack: Open[]) => {
    for (const m of value.matchAll(TAG)) {
      const offset = start + m.index!
      if (m[0].startsWith('<!--')) {
        if (!m[0].endsWith('-->')) {
          // the comment runs to the end of the document; close it at the end of its first line
          const eol = text.indexOf('\n', offset)
          issues.push({ kind: 'comment', tag: '<!--', line: lineAt(text, offset), offset, fix: { at: eol < 0 ? text.length : eol, insert: ' -->' } })
        }
        continue
      }
      const name = m[1].toLowerCase()
      if (VOID.has(name) || m[2] === '/') continue
      if (!m[0].startsWith('</')) {
        stack.push({ tag: name, offset, line: lineAt(text, offset) })
        continue
      }
      // a closing tag: close the nearest open one of the same name
      const i = stack.map((o) => o.tag).lastIndexOf(name)
      if (i < 0) {
        if (!OPTIONAL_END.has(name)) issues.push({ kind: 'stray', tag: name, line: lineAt(text, offset), offset, fix: { remove: [offset, offset + m[0].length] } })
        continue
      }
      // anything opened inside it and not closed is unclosed
      for (const o of stack.splice(i).slice(1)) unclosed(o, offset)
    }
  }

  /** An unclosed tag; `end`: where its closing tag can go. */
  const unclosed = (o: Open, end: number) => {
    if (OPTIONAL_END.has(o.tag)) return
    issues.push({ kind: 'unclosed', tag: o.tag, line: o.line, offset: o.offset, fix: { at: end, insert: `</${o.tag}>` } })
  }

  const visit = (node: Nodes) => {
    const children = 'children' in node ? (node.children as RootContent[]) : []
    // inline HTML: tags must close within their paragraph / heading / cell
    if (children.some((c) => c.type === 'html') && !['root', 'blockquote', 'listItem', 'footnoteDefinition'].includes(node.type)) {
      const stack: Open[] = []
      for (const c of children) if (c.type === 'html' && c.position) scan(c.value, c.position.start.offset!, stack)
      for (const o of stack) unclosed(o, (node as Parent).position!.end.offset!)
    } else {
      for (const c of children) if (c.type === 'html' && c.position) scan(c.value, c.position.start.offset!, blockStack)
    }
    for (const c of children) if ('children' in c) visit(c)
  }
  visit(tree)
  // block tags still open at the end: close at the end of the document
  for (const o of blockStack) unclosed(o, text.replace(/\s+$/, '').length)
  return issues.sort((a, b) => a.offset - b.offset)
}

/** Apply a fix to the text; returns the new text and where the change is. */
export function applyFix(text: string, issue: LintIssue): { text: string; from: number; to: number; insert: string } {
  const f = issue.fix!
  if ('remove' in f) return { text: text.slice(0, f.remove[0]) + text.slice(f.remove[1]), from: f.remove[0], to: f.remove[1], insert: '' }
  // a block tag closed at the end of the document goes on a line of its own, after a blank line
  const insert = issue.kind === 'unclosed' && f.at >= text.replace(/\s+$/, '').length && /\n/.test(text) ? `\n\n${f.insert}` : f.insert
  return { text: text.slice(0, f.at) + insert + text.slice(f.at), from: f.at, to: f.at, insert }
}
