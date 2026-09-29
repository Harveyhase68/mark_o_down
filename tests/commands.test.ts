import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'
import { inCenter, toggleCenter } from '../src/editor/commands'

/** Run a command with the cursor at the first occurrence of `at`; returns the new Markdown. */
function run(md: string, at: string, cmd: Command) {
  const { doc, meta } = importMarkdown(md)
  let pos = -1
  doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text!.includes(at)) pos = p + n.text!.indexOf(at)
    return pos < 0
  })
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) })
  const ok = cmd(state, (tr) => (state = state.apply(tr)))
  return { ok, state, md: exportMarkdown(state.doc, meta) }
}

describe('center', () => {
  const md = 'Intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nOutro\n'

  it('centers the whole table when the cursor is in a cell', () => {
    const r = run(md, '2', toggleCenter)
    expect(r.ok).toBe(true)
    expect(r.md).toBe('Intro\n\n<div align="center">\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n</div>\n\nOutro\n')
    expect(inCenter(r.state)).toBe(true)
  })

  it('un-centers it again from inside the table', () => {
    const centered = run(md, '2', toggleCenter).md
    expect(run(centered, '2', toggleCenter).md).toBe(md)
  })

  it('still centers a paragraph', () => {
    expect(run(md, 'Intro', toggleCenter).md).toBe('<div align="center">\n\nIntro\n\n</div>\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nOutro\n')
  })
})
