// Formulas in the editor.
//
// Inline `$…$` is an atom showing the formula; double-click edits its TeX in a
// dialog with live preview. A `$$` block shows the formula and, while the cursor
// is in it, its TeX source below (editable like a code block).
// The renderer (Temml) is loaded when the first formula appears.

import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeViewConstructor } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../md/schema'
import { loadMath, type MathRenderer } from '../md/mathRender'
import { openDialog } from './dialog'
import { t } from '../i18n'

const S = schema.nodes

let renderer: MathRenderer | null = null
let loading: Promise<MathRenderer> | null = null

/** Temml + its stylesheet for the editor. */
function load(): Promise<MathRenderer> {
  loading ??= Promise.all([loadMath(), import('temml/dist/Temml-Local.css')]).then(([r]) => (renderer = r))
  return loading
}

/** Formula into `el`; before the renderer is loaded (or for empty TeX) the source / a hint. */
function show(el: HTMLElement, tex: string, display: boolean) {
  const empty = !tex.trim()
  el.classList.toggle('math-placeholder', empty)
  el.classList.toggle('math-source', !empty && !renderer)
  if (empty) el.textContent = t('math.empty')
  else if (renderer) el.innerHTML = renderer.render(tex, display)
  else el.textContent = display ? tex : `$${tex}$`
}

// ------------------------------------------------------------------ node views

export const mathInlineView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('span')
  dom.className = 'math-inline'
  const inner = document.createElement('span')
  dom.append(inner)
  let tex = node.attrs.tex as string
  const render = () => {
    show(inner, tex, false)
    dom.title = `${tex}\n${t('math.hint')}`
  }
  render()
  dom.ondblclick = () => void editMathInline(view, getPos()!)
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false
      if (n.attrs.tex !== tex) {
        tex = n.attrs.tex
        render()
      }
      return true
    },
  }
}

export const mathBlockView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'math-block'
  const preview = document.createElement('div')
  preview.className = 'math-preview'
  preview.contentEditable = 'false'
  const source = document.createElement('pre')
  dom.append(preview, source)
  let tex = node.textContent
  show(preview, tex, true)
  // a click on the formula puts the cursor into its source
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
      if (n.textContent !== tex) {
        tex = n.textContent
        show(preview, tex, true)
      }
      return true
    },
    // the preview is ours, not ProseMirror's
    ignoreMutation: (m) => preview.contains(m.target),
  }
}

// ------------------------------------------------------------------ plugin

const hasMath = (doc: PMNode) => {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (n.type === S.math_inline || n.type === S.math_block) found = true
    return !found
  })
  return found
}

/** Mark the formula / diagram block the cursor is in (shows its source). */
function editing(state: EditorState): DecorationSet {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === S.math_block || $from.node(d).type === S.mermaid_block) {
      const pos = $from.before(d)
      return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $from.node(d).nodeSize, { class: 'math-editing' })])
    }
  }
  return DecorationSet.empty
}

/** `redraw`: re-create node views once the renderer is there. */
export function mathPlugin(redraw: () => void) {
  return new Plugin({
    key: new PluginKey('math'),
    props: {
      decorations: editing,
    },
    view(view) {
      const check = () => {
        if (renderer || !hasMath(view.state.doc)) return
        void load().then(() => {
          if (!view.isDestroyed) redraw()
        })
      }
      check()
      return { update: check }
    },
  })
}

// ------------------------------------------------------------------ editing

/** Dialog with live preview; resolves with the TeX, '' to remove, null if cancelled. */
async function askTex(title: string, tex: string): Promise<string | null> {
  void load()
  const res = await openDialog({
    title,
    fields: [{ name: 'tex', label: t('math.tex'), value: tex, multiline: true, placeholder: 'E = mc^2' }],
    extra: (box) => {
      const preview = document.createElement('div')
      preview.className = 'math-dialog-preview'
      box.append(preview)
      const input = box.closest('form')!.querySelector('textarea')!
      input.rows = 3
      const update = () => show(preview, input.value, true)
      input.addEventListener('input', update)
      void load().then(update)
      update()
    },
  })
  return res ? res.values.tex.trim() : null
}

export async function editMathInline(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type !== S.math_inline) return
  const tex = await askTex(t('math.edit'), node.attrs.tex)
  view.focus()
  if (tex === null) return
  const tr = view.state.tr
  if (tex) tr.setNodeMarkup(pos, null, { tex })
  else tr.delete(pos, pos + node.nodeSize)
  view.dispatch(tr)
}

/**
 * Toolbar "Formula": in an empty paragraph a formula block (type the TeX right away),
 * with text selected that text as formula, otherwise the dialog for an inline formula.
 */
export async function insertMath(view: EditorView) {
  const { state } = view
  const { $from, $to, empty } = state.selection
  if ($from.parent.type.spec.code || !$from.parent.inlineContent) return
  if (empty && $from.parent.type === S.paragraph && !$from.parent.childCount) {
    const pos = $from.before()
    const tr = state.tr.replaceWith(pos, pos + $from.parent.nodeSize, S.math_block.create())
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView())
    view.focus()
    return
  }
  if (!empty && $from.sameParent($to)) {
    const tex = state.doc.textBetween($from.pos, $to.pos).trim()
    if (tex) {
      view.dispatch(state.tr.replaceSelectionWith(S.math_inline.create({ tex }), false).scrollIntoView())
      view.focus()
      return
    }
  }
  const tex = await askTex(t('math.insert'), '')
  view.focus()
  if (tex) view.dispatch(view.state.tr.replaceSelectionWith(S.math_inline.create({ tex }), false).scrollIntoView())
}
