// What the HTML export, "Copy HTML" and printing need for a document: code
// colouring and formulas – loaded only if the document can contain them.

import type { RenderOptions } from './html'
import { loadHighlighter } from '../editor/highlight'
import { loadMath } from './mathRender'

export async function renderOptions(markdown: string): Promise<RenderOptions> {
  const [highlight, math] = await Promise.all([
    /```|~~~/.test(markdown) ? loadHighlighter().catch(() => undefined) : undefined,
    markdown.includes('$') || /```\s*math/i.test(markdown) ? loadMath().catch(() => undefined) : undefined,
  ])
  return { highlight, math }
}
