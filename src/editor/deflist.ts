// Editing definition lists (extended syntax):
//   • `: ` at the start of a paragraph below a paragraph → that paragraph becomes the
//     term, this one its definition (below a definition list: one more definition)
//   • Enter in a term → into its definition
//   • Enter on an empty last line of a definition → next term
//   • Enter in an empty term → out of the list

import { InputRule } from 'prosemirror-inputrules'
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../md/schema'
import { extendedSyntaxOn } from '../md/markdown'

const S = schema.nodes

const emptyPara = (n: PMNode | null | undefined) => !!n && n.type === S.paragraph && !n.content.size
const newPair = () => [S.def_term.create(), S.def_desc.create(null, S.paragraph.create())]

export const defListInputRule = new InputRule(/^:\s$/, (state: EditorState, _m, start, end) => {
  if (!extendedSyntaxOn()) return null
  const $s = state.doc.resolve(start)
  const para = $s.parent
  if (para.type !== S.paragraph || $s.parentOffset !== 0 || $s.depth < 1) return null
  const index = $s.index($s.depth - 1)
  if (index === 0) return null
  const prev = $s.node($s.depth - 1).child(index - 1)
  const paraPos = $s.before()
  const prevPos = paraPos - prev.nodeSize
  const rest = para.content.cut(end - $s.start())
  const desc = S.def_desc.create(null, S.paragraph.create(null, rest))
  const tr = state.tr
  if (prev.type === S.paragraph && prev.content.size && !prev.attrs.htmlBlock) {
    tr.replaceWith(prevPos, paraPos + para.nodeSize, S.def_list.create(null, [S.def_term.create(null, prev.content), desc]))
    return tr.setSelection(TextSelection.create(tr.doc, prevPos + 1 + prev.content.size + 2 + 2))
  }
  if (prev.type === S.def_list) {
    tr.replaceWith(paraPos - 1, paraPos + para.nodeSize, desc) // append inside the list (before its end token)
    return tr.setSelection(TextSelection.create(tr.doc, paraPos - 1 + 2))
  }
  return null
})

export const defListEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty) return false
  let tr: Transaction | null = null

  if ($from.parent.type === S.def_term) {
    const list = $from.node(-1)
    const i = $from.index(-1)
    const termPos = $from.before()
    const termEnd = $from.after()
    const next = list.maybeChild(i + 1)
    if (!$from.parent.content.size && next && next.childCount === 1 && emptyPara(next.firstChild)) {
      // empty term with its empty definition: leave the list
      const listEnd = $from.after(-1)
      tr = state.tr.insert(listEnd, S.paragraph.create())
      tr.delete(termPos, termEnd + next.nodeSize)
      const after = tr.mapping.map(listEnd)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size))))
    } else if (next && next.childCount === 1 && emptyPara(next.firstChild)) {
      tr = state.tr.setSelection(TextSelection.create(state.doc, termEnd + 2))
    } else {
      tr = state.tr.insert(termEnd, S.def_desc.create(null, S.paragraph.create()))
      tr.setSelection(TextSelection.create(tr.doc, termEnd + 2))
    }
  } else if (emptyPara($from.parent) && $from.depth >= 3 && $from.node(-1).type === S.def_desc && $from.index(-1) === $from.node(-1).childCount - 1) {
    const desc = $from.node(-1)
    const descEnd = $from.after(-1)
    const paraPos = $from.before()
    if (desc.childCount > 1) {
      // end of a longer definition: drop the empty line, next term
      tr = state.tr.insert(descEnd, newPair())
      tr.delete(paraPos, paraPos + $from.parent.nodeSize)
      const termPos = tr.mapping.map(descEnd, -1) // before the inserted pair, not after it
      tr.setSelection(TextSelection.create(tr.doc, termPos + 1))
    } else {
      // an empty definition: next term (the empty definition is kept for the current one)
      tr = state.tr.insert(descEnd, newPair())
      tr.setSelection(TextSelection.create(tr.doc, descEnd + 1))
    }
  }
  if (!tr) return false
  dispatch?.(tr.scrollIntoView())
  return true
}
