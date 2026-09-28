import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { importMarkdown, exportMarkdown } from '../src/md/document'
import { schema } from '../src/md/schema'
import { altFromUrl, asUrl, classifyPaste, isImageUrl, pastedImageStem, pasteUrl } from '../src/editor/paste'

function fakeView(md: string, select?: string) {
  const { doc, meta } = importMarkdown(md)
  let state = EditorState.create({ schema, doc })
  if (select) {
    let from = -1
    doc.descendants((n, p) => {
      if (from < 0 && n.isText && n.text!.includes(select)) from = p + n.text!.indexOf(select)
      return from < 0
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, from + select.length)))
  } else {
    // "|" in the text marks the cursor
    let at = -1
    doc.descendants((n, p) => {
      if (at < 0 && n.isText && n.text!.includes('|')) at = p + n.text!.indexOf('|')
      return at < 0
    })
    state = state.apply(state.tr.delete(at, at + 1))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
  }
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      state = state.apply(tr)
    },
  } as unknown as EditorView
  return { view, md: () => exportMarkdown(view.state.doc, meta) }
}

/** Minimal DataTransfer stand-in. */
const clip = (data: Record<string, string>, files: { type: string }[] = []) =>
  ({ getData: (t: string) => data[t] ?? '', files }) as unknown as DataTransfer

describe('recognising what was pasted', () => {
  it('URLs', () => {
    expect(asUrl('  https://predl.cc/x?a=1 ')).toBe('https://predl.cc/x?a=1')
    expect(asUrl('www.predl.cc')).toBe('www.predl.cc')
    expect(asUrl('siehe https://predl.cc')).toBeNull()
    expect(asUrl('zwei\nzeilen')).toBeNull()
  })

  it('image addresses', () => {
    expect(isImageUrl('https://x.dev/a/logo.PNG?v=2')).toBe(true)
    expect(isImageUrl('https://img.shields.io/badge/a-b-blue')).toBe(true)
    expect(isImageUrl('https://cdn.simpleicons.org/rust')).toBe(true)
    expect(isImageUrl('https://predl.cc/impressum/')).toBe(false)
    expect(altFromUrl('https://x.dev/Mein-Logo_2.png?x=1')).toBe('Mein Logo 2')
  })

  it('screenshot → image, browser image with <img> → normal paste, URL → link', () => {
    expect(classifyPaste(clip({}, [{ type: 'image/png' }]), false)).toHaveProperty('image')
    expect(classifyPaste(clip({ 'text/html': '<img src="https://x.dev/a.png">' }, [{ type: 'image/png' }]), false)).toBeNull()
    expect(classifyPaste(clip({ 'text/plain': 'https://predl.cc' }), false)).toEqual({ url: 'https://predl.cc' })
    expect(classifyPaste(clip({ 'text/plain': 'https://predl.cc' }), true)).toBeNull() // code block: plain text
    expect(classifyPaste(clip({ 'text/plain': 'Hallo Welt' }), false)).toBeNull()
  })

  it('file names for pasted images', () => {
    expect(pastedImageStem(new Date(2026, 8, 28, 19, 5, 3))).toBe('image-20260928-190503')
  })
})

describe('pasting a URL', () => {
  it('turns the selected text into a link', () => {
    const { view, md } = fakeView('Meine Website ist hier.\n', 'Website')
    pasteUrl(view, 'https://predl.cc')
    expect(md()).toBe('Meine [Website](https://predl.cc) ist hier.\n')
  })

  it('without a selection: inserts a link showing the address', () => {
    const { view, md } = fakeView('Siehe | für mehr.\n')
    pasteUrl(view, 'https://predl.cc')
    expect(md()).toBe('Siehe https://predl.cc für mehr.\n')
    // …and it really is a link in the editor
    const link = view.state.doc.firstChild!.child(1).marks.find((m) => m.type.name === 'link')
    expect(link?.attrs.href).toBe('https://predl.cc')
  })

  it('an image address becomes an image', () => {
    const { view, md } = fakeView('Badge: | Ende\n')
    pasteUrl(view, 'https://img.shields.io/badge/License-MIT-yellow.svg')
    expect(md()).toBe('Badge: ![License MIT yellow](https://img.shields.io/badge/License-MIT-yellow.svg) Ende\n')
  })

  it('www. addresses get https://', () => {
    const { view, md } = fakeView('Text\n', 'Text')
    pasteUrl(view, 'www.predl.cc')
    expect(md()).toBe('[Text](https://www.predl.cc)\n')
  })
})
