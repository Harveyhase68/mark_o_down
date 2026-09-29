import type { Command, EditorState } from 'prosemirror-state'
import type { MarkType, Node as PMNode, NodeType, ResolvedPos } from 'prosemirror-model'
import { findWrapping } from 'prosemirror-transform'
import { setBlockType, wrapIn, lift } from 'prosemirror-commands'
import { wrapInList, liftListItem, splitListItem } from 'prosemirror-schema-list'
import { TextSelection } from 'prosemirror-state'
import { addRowAfter, goToNextCell, isInTable, selectedRect, selectionCell } from 'prosemirror-tables'
import { schema } from '../md/schema'

const N = schema.nodes
const K = schema.marks

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

/** Range of the mark of `type` around `$pos` (e.g. the whole link under the cursor). */
export function markRange($pos: ResolvedPos, type: MarkType): { from: number; to: number; mark: ReturnType<MarkType['create']> } | null {
  const parent = $pos.parent
  let start = $pos.index()
  // at the end of a text node the cursor "belongs" to the node before
  if (start >= parent.childCount || !type.isInSet(parent.child(start).marks)) start--
  if (start < 0 || start >= parent.childCount) return null
  const mark = type.isInSet(parent.child(start).marks)
  if (!mark) return null
  let end = start + 1
  while (start > 0 && mark.isInSet(parent.child(start - 1).marks)) start--
  while (end < parent.childCount && mark.isInSet(parent.child(end).marks)) end++
  let from = $pos.start()
  for (let i = 0; i < start; i++) from += parent.child(i).nodeSize
  let to = from
  for (let i = start; i < end; i++) to += parent.child(i).nodeSize
  return { from, to, mark }
}

/** Which list (if any) directly contains the selection. */
export function currentList(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === N.bullet_list || node.type === N.ordered_list) return { node, pos: $from.before(d) }
  }
  return null
}

/** Bullet/ordered toggle: lift out, switch type, or wrap. */
export function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const list = currentList(state)
    if (list && list.node.type === type) return liftListItem(N.list_item)(state, dispatch)
    if (list) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(list.pos, type))
      return true
    }
    return wrapInList(type)(state, dispatch)
  }
}

export function toggleBlockquote(): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.blockquote) return lift(state, dispatch)
    return wrapIn(N.blockquote)(state, dispatch)
  }
}

export function setHeading(level: number): Command {
  return level === 0 ? setBlockType(N.paragraph) : setBlockType(N.heading, { level })
}

export function currentBlockLevel(state: EditorState): number | null {
  const parent = state.selection.$from.parent
  if (parent.type === N.heading) return parent.attrs.level
  if (parent.type === N.paragraph) return 0
  return null
}

export interface LinkInfo {
  href: string
  title: string | null
  text: string
  from: number
  to: number
  existing: boolean
}

/** Current link under cursor/selection, or the selected text as a new link. */
export function linkAtSelection(state: EditorState): LinkInfo {
  const { from, to, $from } = state.selection
  const range = markRange($from, K.link)
  if (range && range.from <= from && range.to >= to) {
    return { href: range.mark.attrs.href, title: range.mark.attrs.title, text: state.doc.textBetween(range.from, range.to, ' ', ' '), from: range.from, to: range.to, existing: true }
  }
  return { href: '', title: null, text: state.doc.textBetween(from, to, ' ', ' '), from, to, existing: false }
}

export function applyLink(info: LinkInfo, href: string, title: string | null, text: string): Command {
  return (state, dispatch) => {
    if (!dispatch) return true
    let tr = state.tr
    let { from, to } = info
    if (from === to || (!info.existing && text !== info.text)) {
      // insert (or replace) the visible text
      const t = text || href
      tr = tr.insertText(t, from, to)
      to = from + t.length
    }
    tr = tr.removeMark(from, to, K.link)
    if (href) tr = tr.addMark(from, to, K.link.create({ href, title: title || null }))
    dispatch(tr.scrollIntoView())
    return true
  }
}

export function removeLink(info: LinkInfo): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.removeMark(info.from, info.to, K.link))
    return true
  }
}

export const insertHardBreak: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) return false
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView())
  return true
}

export const insertRule: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.horizontal_rule.create()).scrollIntoView())
  return true
}

/** Enter in a list: the new item is a fresh (unchecked, if a task) item. */
export const splitItem: Command = (state, dispatch, view) => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === N.list_item) return splitListItem(N.list_item, { checked: node.attrs.checked === null ? null : false })(state, dispatch, view)
  }
  return false
}

/** Toggle `[ ]` on the list item containing the selection. */
export const toggleTask: Command = (state, dispatch) => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === N.list_item) {
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), null, { ...node.attrs, checked: node.attrs.checked === null ? false : null }))
      return true
    }
  }
  return false
}

// ------------------------------------------------------------------ center

export const toggleCenter: Command = (state, dispatch) => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === N.center) {
      // unwrap: replace the center node by its content
      if (dispatch) {
        const pos = $from.before(d)
        const node = $from.node(d)
        dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.content))
      }
      return true
    }
  }
  // in a table: center the whole table (a cell can't hold a center block)
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === N.table) {
      const range = state.doc.resolve($from.before(d)).blockRange(state.doc.resolve($from.after(d)))
      const wrapping = range && findWrapping(range, N.center)
      if (!range || !wrapping) return false
      if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
      return true
    }
  }
  return wrapIn(N.center)(state, dispatch)
}

export const inCenter = (state: EditorState) => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.center) return true
  return false
}

// ------------------------------------------------------------------ tables

export function insertTable(cols = 3, rows = 2): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const cell = (type: NodeType) => type.create()
      const header = N.table_row.create(null, Array.from({ length: cols }, () => cell(N.table_header)))
      const body = Array.from({ length: rows }, () => N.table_row.create(null, Array.from({ length: cols }, () => cell(N.table_cell))))
      const table = N.table.create(null, [header, ...body])
      const tr = state.tr.replaceSelectionWith(table)
      // cursor into the first header cell
      const start = tr.mapping.map(state.selection.from, -1)
      let found = -1
      tr.doc.nodesBetween(start, Math.min(tr.doc.content.size, start + table.nodeSize + 2), (n, pos) => {
        if (found < 0 && n.type === N.table_header) found = pos + 1
        return found < 0
      })
      dispatch((found >= 0 ? tr.setSelection(TextSelection.create(tr.doc, found)) : tr).scrollIntoView())
    }
    return true
  }
}

/** Set the alignment of the column(s) containing the selection. */
export function alignColumn(align: 'left' | 'center' | 'right' | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    if (dispatch) {
      const rect = selectedRect(state)
      const tr = state.tr
      for (let col = rect.left; col < rect.right; col++) {
        for (let row = 0; row < rect.map.height; row++) {
          const pos = rect.tableStart + rect.map.map[row * rect.map.width + col]
          const cell = tr.doc.nodeAt(pos)
          if (cell) tr.setNodeMarkup(pos, null, { ...cell.attrs, align })
        }
      }
      dispatch(tr)
    }
    return true
  }
}

export function columnAlign(state: EditorState): string | null {
  if (!isInTable(state)) return null
  const $cell = selectionCell(state)
  return $cell.nodeAfter?.attrs.align ?? null
}

/** Tab in a table: next cell; in the last cell a new row is added first. */
export const nextCellOrNewRow: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return false
  if (goToNextCell(1)(state, dispatch)) return true
  if (!dispatch || !view) return true
  addRowAfter(state, dispatch)
  // first cell of the new row
  const rect = selectedRect(view.state)
  const pos = rect.tableStart + rect.map.map[rect.map.width * (rect.map.height - 1)]
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView())
  return true
}

/** Enter inside a table cell: a line break (written as `<br>`). */
export const cellLineBreak: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView())
  return true
}
