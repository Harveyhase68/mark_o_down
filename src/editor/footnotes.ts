// Footnotes in the editor: numbered like GitHub (1, 2, 3 … in the order of the
// first reference, whatever the labels are), the reference shows the note's text
// as tooltip, a double-click on it jumps to the note.

import { Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../md/schema'

const S = schema.nodes

/** Labels match case-insensitively, like link references. */
const key = (label: string) => label.replace(/\s+/g, ' ').trim().toLowerCase()

interface Info {
  /** label key → number shown */
  numbers: Map<string, number>
  /** label key → position of the definition */
  defs: Map<string, number>
}

function collect(doc: PMNode): Info {
  const numbers = new Map<string, number>()
  const defs = new Map<string, number>()
  doc.descendants((n, pos) => {
    const k = n.type === S.footnote_ref || n.type === S.footnote_def ? key(n.attrs.label) : null
    if (n.type === S.footnote_ref && !numbers.has(k!)) numbers.set(k!, numbers.size + 1)
    if (n.type === S.footnote_def && !defs.has(k!)) defs.set(k!, pos)
  })
  return { numbers, defs }
}

function decorations(doc: PMNode): DecorationSet {
  const { numbers, defs } = collect(doc)
  const decos: Decoration[] = []
  doc.descendants((n, pos) => {
    if (n.type === S.footnote_ref) {
      const k = key(n.attrs.label)
      const def = defs.get(k)
      const note = def === undefined ? '' : doc.nodeAt(def)!.textContent
      decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-n': String(numbers.get(k)), title: note.length > 300 ? note.slice(0, 300) + '…' : note }))
    } else if (n.type === S.footnote_def) {
      const n2 = numbers.get(key(n.attrs.label))
      // a note nobody refers to shows its label
      decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-n': n2 === undefined ? n.attrs.label : String(n2) }))
    }
  })
  return DecorationSet.create(doc, decos)
}

export const footnotePlugin = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => decorations(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
    // double-click on a reference: go to the note
    handleDoubleClickOn(view, _pos, node) {
      if (node.type !== S.footnote_ref) return false
      const def = collect(view.state.doc).defs.get(key(node.attrs.label))
      if (def === undefined) return false
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(def + 1))).scrollIntoView())
      view.focus()
      return true
    },
  },
})

/** Next free numeric label (`[^1]`, `[^2]` …). */
function nextLabel(state: EditorState): string {
  const used = new Set<string>()
  state.doc.descendants((n) => {
    if (n.type === S.footnote_ref || n.type === S.footnote_def) used.add(key(n.attrs.label))
  })
  let i = 1
  while (used.has(String(i))) i++
  return String(i)
}

/** Insert a footnote reference at the cursor and its note at the end of the document; the cursor goes into the note. */
export const insertFootnote: Command = (state, dispatch) => {
  const { $from } = state.selection
  if ($from.parent.type.spec.code || !$from.parent.inlineContent) return false
  if (dispatch) {
    const label = nextLabel(state)
    const tr = state.tr.replaceSelectionWith(S.footnote_ref.create({ label }), false)
    const end = tr.doc.content.size
    tr.insert(end, S.footnote_def.create({ label }, S.paragraph.create()))
    tr.setSelection(TextSelection.create(tr.doc, end + 2)).scrollIntoView()
    dispatch(tr)
  }
  return true
}
