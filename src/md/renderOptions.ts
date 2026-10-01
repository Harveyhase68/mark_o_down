// What the HTML export, "Copy HTML" and printing need for a document: code
// colouring, formulas and diagrams – loaded only if the document can contain them.

import type { RenderOptions } from './html'
import { loadHighlighter } from '../editor/highlight'
import { loadMath } from './mathRender'
import { parseMarkdown } from './markdown'
import { loadMermaid, renderMermaid } from '../editor/mermaid'

/** The ```mermaid sources of a document, drawn as SVG (light theme: pages are printed and shared). */
async function drawDiagrams(markdown: string): Promise<Map<string, string> | undefined> {
  const sources: string[] = []
  const visit = (n: { type: string; lang?: string | null; value?: string; children?: unknown[] }) => {
    if (n.type === 'code' && n.lang === 'mermaid' && n.value) sources.push(n.value)
    n.children?.forEach((c) => visit(c as never))
  }
  visit(parseMarkdown(markdown) as never)
  if (!sources.length) return undefined
  const m = await loadMermaid()
  const out = new Map<string, string>()
  for (const s of sources) {
    // a broken diagram stays code, like on GitHub's error box it is still readable
    const svg = await renderMermaid(m, s, false).catch(() => null)
    if (svg) out.set(s, svg)
  }
  return out
}

export async function renderOptions(markdown: string): Promise<RenderOptions> {
  const [highlight, math, mermaid] = await Promise.all([
    /```|~~~/.test(markdown) ? loadHighlighter().catch(() => undefined) : undefined,
    markdown.includes('$') || /```\s*math/i.test(markdown) ? loadMath().catch(() => undefined) : undefined,
    /```\s*mermaid/.test(markdown) ? drawDiagrams(markdown).catch(() => undefined) : undefined,
  ])
  return { highlight, math, mermaid }
}
