// Mermaid diagrams (```mermaid), like on GitHub.
//
// The block shows the diagram; with the cursor in it, its source below (editable
// like a code block, the diagram follows while typing). Mermaid (~2.5 MB) is loaded
// only when a document contains a diagram.

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorView, NodeViewConstructor } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import type { Mermaid } from 'mermaid'
import { schema } from '../md/schema'
import { t } from '../i18n'

const S = schema.nodes

let mermaid: Mermaid | null = null
let loading: Promise<Mermaid> | null = null
let theme: 'default' | 'dark' | null = null

export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => (mermaid = m.default))
  return loading
}

let counter = 0
// one diagram at a time: Mermaid's render isn't meant to run in parallel
let queue: Promise<unknown> = Promise.resolve()

/** SVG of a diagram, or throws with Mermaid's error message. */
export function renderMermaid(m: Mermaid, source: string, dark: boolean): Promise<string> {
  const run = async () => {
    const wanted = dark ? 'dark' : 'default'
    if (theme !== wanted) {
      // strict: no scripts, no HTML labels from the document – it may come from anywhere
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: wanted, suppressErrorRendering: true })
      theme = wanted
    }
    const { svg } = await m.render(`mod-mermaid-${++counter}`, source)
    return svg
  }
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}

const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export const mermaidBlockView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'mermaid-block'
  const preview = document.createElement('div')
  preview.className = 'mermaid-preview'
  preview.contentEditable = 'false'
  const source = document.createElement('pre')
  dom.append(preview, source)

  let text = node.textContent
  let timer = 0
  let shown = '' // source of the diagram on screen
  const draw = async () => {
    if (!text.trim()) {
      preview.className = 'mermaid-preview mermaid-placeholder'
      preview.textContent = t('mermaid.empty')
      return
    }
    if (!mermaid) {
      preview.className = 'mermaid-preview mermaid-placeholder'
      preview.textContent = t('mermaid.loading')
      return
    }
    const wanted = text
    try {
      const svg = await renderMermaid(mermaid, wanted, dark())
      if (wanted !== text) return // typed on meanwhile
      preview.className = 'mermaid-preview'
      preview.innerHTML = svg
      shown = wanted
    } catch (e) {
      if (wanted !== text) return
      // keep the last good diagram while typing, the error below it
      preview.className = 'mermaid-preview mermaid-error'
      if (!shown) preview.textContent = ''
      preview.querySelector('.mermaid-message')?.remove()
      const msg = document.createElement('div')
      msg.className = 'mermaid-message'
      msg.textContent = `${t('mermaid.error')}: ${String((e as Error).message ?? e).split('\n')[0]}`
      preview.append(msg)
    }
  }
  void draw()

  // a click on the diagram puts the cursor into its source
  preview.onmousedown = (e) => {
    e.preventDefault()
    const pos = getPos()
    if (pos === undefined) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + view.state.doc.nodeAt(pos)!.content.size)))
    view.focus()
  }

  return {
    dom,
    contentDOM: source,
    update(n) {
      if (n.type !== node.type) return false
      if (n.textContent !== text) {
        text = n.textContent
        clearTimeout(timer)
        timer = window.setTimeout(() => void draw(), 400)
      }
      return true
    },
    ignoreMutation: (m) => preview.contains(m.target),
    destroy: () => clearTimeout(timer),
  }
}

const hasDiagram = (doc: PMNode) => {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (n.type === S.mermaid_block) found = true
    return !found
  })
  return found
}

/** Load Mermaid the first time a diagram shows up; `redraw` re-creates the node views. */
export function mermaidPlugin(redraw: () => void) {
  return new Plugin({
    key: new PluginKey('mermaid'),
    view(view) {
      const check = () => {
        if (mermaid || !hasDiagram(view.state.doc)) return
        void loadMermaid().then(() => {
          if (!view.isDestroyed) redraw()
        })
      }
      check()
      return { update: check }
    },
  })
}

const EXAMPLE = 'flowchart LR\n  A[Start] --> B{OK?}\n  B -- ja --> C[Fertig]\n  B -- nein --> A'

/** Toolbar "Diagram": a Mermaid block with a small example, its source ready for editing. */
export function insertMermaid(view: EditorView) {
  const { state } = view
  const { $from } = state.selection
  if ($from.parent.type.spec.code) return
  const block = S.mermaid_block.create(null, schema.text(EXAMPLE))
  const empty = $from.parent.type === S.paragraph && !$from.parent.childCount
  const pos = empty ? $from.before() : $from.after($from.depth === 0 ? 0 : 1)
  const tr = empty ? state.tr.replaceWith(pos, pos + $from.parent.nodeSize, block) : state.tr.insert(pos, block)
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1 + EXAMPLE.length)).scrollIntoView())
  view.focus()
}
