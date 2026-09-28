import { EditorState, Plugin, type Command } from 'prosemirror-state'
import { EditorView, type NodeViewConstructor } from 'prosemirror-view'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, chainCommands, exitCode } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { sinkListItem, liftListItem } from 'prosemirror-schema-list'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from '../md/schema'
import { tagAttrs } from '../md/htmlTags'
import { importMarkdown, exportMarkdown, NEW_DOC_META } from '../md/document'
import { tableEditing, goToNextCell } from 'prosemirror-tables'
import { buildInputRules } from './inputrules'
import { searchPlugin } from './search'
import { classifyPaste, pasteUrl } from './paste'
import { openDialog } from './dialog'
import { openPicker } from '../badges/picker'
import { openEmojiPicker } from '../emoji/picker'
import {
  applyLink,
  cellLineBreak,
  nextCellOrNewRow,
  insertHardBreak,
  linkAtSelection,
  removeLink,
  setHeading,
  splitItem,
  toggleBlockquote,
  toggleList,
} from './commands'

const N = schema.nodes
const K = schema.marks

export interface EditorHooks {
  /** Turn a Markdown image `src` into something the webview can load. */
  resolveImage: (src: string) => string
  /** Absolute path of the open document (null if unsaved). */
  docPath: () => string | null
  /** Let the user pick a local image; returns a Markdown path or null. */
  pickImage?: () => Promise<string | null>
  openExternal: (href: string) => void
  /** Ctrl+V of image data (screenshot …): store it next to the document and insert it. */
  pasteImage: (view: EditorView, image: File) => void
  onChange: (view: EditorView) => void
  extraKeys?: Record<string, Command>
}

// ------------------------------------------------------------------ dialogs

export async function editLink(view: EditorView) {
  const info = linkAtSelection(view.state)
  const res = await openDialog({
    title: info.existing ? 'Link bearbeiten' : 'Link einfügen',
    fields: [
      { name: 'text', label: 'Text', value: info.text },
      { name: 'href', label: 'URL', value: info.href, placeholder: 'https://…' },
      { name: 'title', label: 'Titel (optional)', value: info.title ?? '' },
    ],
    buttons: [
      ...(info.existing ? [{ label: 'Link entfernen', value: 'remove', danger: true }] : []),
      { label: 'Abbrechen', value: 'cancel' },
      { label: 'OK', value: 'ok', primary: true },
    ],
  })
  view.focus()
  if (!res) return
  if (res.action === 'remove') removeLink(info)(view.state, view.dispatch)
  else applyLink(info, res.values.href.trim(), res.values.title.trim() || null, res.values.text)(view.state, view.dispatch)
}

/** Insert (pos undefined) or edit an image via the badge/icon/image picker. */
export async function editImage(view: EditorView, hooks: EditorHooks, pos?: number) {
  const node = pos === undefined ? null : view.state.doc.nodeAt(pos)
  const link = node ? (K.link.isInSet(node.marks) ?? null) : null
  const res = await openPicker({
    tab: node ? 'url' : undefined,
    initial: node ? { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title, html: node.attrs.html, link: link?.attrs.href ?? null } : undefined,
    docPath: hooks.docPath(),
    resolveImage: hooks.resolveImage,
    pickFile: hooks.pickImage,
  })
  view.focus()
  if (!res) return
  const attrs = { src: res.src, alt: res.alt, title: res.title, html: res.html }
  const linkMark = res.link ? K.link.create({ href: res.link }) : null

  if (node && pos !== undefined) {
    // editing the URL detaches a reference-style image from its definition
    const ref = attrs.src === node.attrs.src ? node.attrs.ref : null
    const tr = view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs, ref })
    if ((link?.attrs.href ?? null) !== res.link) {
      tr.removeMark(pos, pos + 1, K.link)
      if (linkMark) tr.addMark(pos, pos + 1, linkMark)
    }
    view.dispatch(tr)
  } else {
    const image = N.image.create(attrs, null, linkMark ? [linkMark] : [])
    view.dispatch(view.state.tr.replaceSelectionWith(image, false).scrollIntoView())
  }
}

/** Emoji & symbol dialog; inserts the chosen character at the cursor. */
export async function insertEmoji(view: EditorView) {
  const ch = await openEmojiPicker()
  view.focus()
  if (ch) view.dispatch(view.state.tr.insertText(ch).scrollIntoView())
}

async function editRawInline(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node) return
  const res = await openDialog({ title: 'Markdown/HTML bearbeiten', fields: [{ name: 'value', label: 'Quelltext', value: node.attrs.value, multiline: true }] })
  view.focus()
  if (!res) return
  const tr = view.state.tr
  if (res.values.value) tr.setNodeMarkup(pos, null, { value: res.values.value })
  else tr.delete(pos, pos + node.nodeSize)
  view.dispatch(tr)
}

// ------------------------------------------------------------------ node views

function imageView(hooks: EditorHooks): NodeViewConstructor {
  return (node, view, getPos) => {
    const img = document.createElement('img')
    const render = (n: PMNode) => {
      img.src = hooks.resolveImage(n.attrs.src)
      img.alt = n.attrs.alt
      img.title = n.attrs.title ?? n.attrs.alt ?? n.attrs.src
      img.dataset.mdSrc = n.attrs.src
      img.classList.remove('broken')
      // an HTML <img> may carry a size: show it like GitHub would
      const html = n.attrs.html ? tagAttrs(n.attrs.html) : {}
      for (const dim of ['width', 'height'] as const) {
        const v = html[dim]
        if (v && /^\d+(\.\d+)?(px|%)?$/.test(v)) img.style[dim] = /\d$/.test(v) ? `${v}px` : v
        else img.style.removeProperty(dim)
      }
      img.classList.toggle('html-img', !!n.attrs.html)
    }
    img.onerror = () => img.classList.add('broken')
    img.ondblclick = () => editImage(view, hooks, getPos())
    render(node)
    return {
      dom: img,
      update: (n) => n.type === node.type && (render(n), true),
    }
  }
}

const rawInlineView: NodeViewConstructor = (node, view, getPos) => {
  const span = document.createElement('span')
  span.className = 'raw-inline'
  span.textContent = node.attrs.value || '∅'
  span.title = 'Markdown/HTML – Doppelklick zum Bearbeiten'
  span.ondblclick = () => editRawInline(view, getPos()!)
  return { dom: span }
}

// ------------------------------------------------------------------ clipboard

/** Plain-text paste is parsed as Markdown (shift-paste inserts it literally). */
function clipboardTextParser(text: string, $context: ResolvedPos, plain: boolean): Slice {
  text = text.replace(/\r\n?/g, '\n')
  if (plain || $context.parent.type.spec.code) return new Slice(Fragment.from(text ? schema.text(text) : null), 0, 0)
  const { doc } = importMarkdown(text, { track: false })
  const single = doc.childCount === 1 && doc.firstChild!.type === N.paragraph
  return single ? new Slice(doc.firstChild!.content, 0, 0) : new Slice(doc.content, 0, 0)
}

/** Copy puts Markdown on the clipboard as text/plain. */
function clipboardTextSerializer(slice: Slice): string {
  const content = slice.content
  const doc = N.doc.createAndFill(null, content) ?? N.doc.create(null, N.paragraph.create(null, content))
  return exportMarkdown(doc, NEW_DOC_META, { preserve: false }).replace(/\n$/, '')
}

// ------------------------------------------------------------------ setup

export interface Editor {
  view: EditorView
  /** Replace the document; resets undo history. */
  load: (doc: PMNode) => void
  /** Re-render images (after the document moved to another folder). */
  refreshImages: () => void
}

export function createEditor(mount: HTMLElement, hooks: EditorHooks): Editor {
  const keys: Record<string, Command> = {
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,
    'Mod-b': toggleMark(K.strong),
    'Mod-i': toggleMark(K.em),
    'Mod-e': toggleMark(K.code),
    'Shift-Mod-x': toggleMark(K.strike),
    'Mod-k': (_s, _d, view) => (view && editLink(view), true),
    'Mod-.': (_s, _d, view) => (view && insertEmoji(view), true),
    'Mod-Alt-0': setHeading(0),
    'Mod-Alt-1': setHeading(1),
    'Mod-Alt-2': setHeading(2),
    'Mod-Alt-3': setHeading(3),
    'Shift-Mod-8': toggleList(N.bullet_list),
    'Shift-Mod-7': toggleList(N.ordered_list),
    'Shift-Mod-9': toggleBlockquote(),
    'Shift-Enter': chainCommands(exitCode, insertHardBreak),
    'Mod-Enter': chainCommands(exitCode, insertHardBreak),
    Enter: chainCommands(cellLineBreak, splitItem),
    Tab: chainCommands(nextCellOrNewRow, sinkListItem(N.list_item)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(N.list_item)),
    ...hooks.extraKeys,
  }

  const behaviour = new Plugin({
    props: {
      handleDOMEvents: {
        // links never navigate inside the editor; Ctrl+click opens them externally
        click(view, e) {
          const a = (e.target as HTMLElement).closest('a')
          if (!a) return false
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) {
            const pos = view.posAtDOM(a, 0)
            const mark = view.state.doc.resolve(pos).marks().find((m) => m.type === K.link) ?? K.link.isInSet(view.state.doc.nodeAt(pos)?.marks ?? [])
            const href = mark?.attrs.href || a.getAttribute('href')
            if (href) hooks.openExternal(href)
            return true
          }
          return false
        },
        mousedown(view, e) {
          const box = (e.target as HTMLElement).closest('.task-box')
          if (!box) return false
          e.preventDefault()
          const li = box.parentElement!
          const pos = view.posAtDOM(li, 0) - 1
          const node = view.state.doc.nodeAt(pos)
          if (node?.type === N.list_item) view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: !node.attrs.checked }))
          return true
        },
      },
      // Ctrl+V of images and links (everything else: the normal HTML/Markdown paste)
      handlePaste(view, event) {
        if (!event.clipboardData) return false
        const what = classifyPaste(event.clipboardData, !!view.state.selection.$from.parent.type.spec.code)
        if (!what) return false
        if ('image' in what) hooks.pasteImage(view, what.image)
        else pasteUrl(view, what.url)
        return true
      },
      handleDoubleClickOn(view, _pos, node, nodePos) {
        if (node.type === N.image) {
          editImage(view, hooks, nodePos)
          return true
        }
        return false
      },
      clipboardTextParser,
      clipboardTextSerializer,
    },
  })

  // a new nodeViews object makes ProseMirror redraw all node views
  const nodeViews = () => ({ image: imageView(hooks), raw_inline: rawInlineView })
  const plugins = [searchPlugin, tableEditing(), buildInputRules(), keymap(keys), keymap(baseKeymap), history(), dropCursor(), gapCursor(), behaviour]
  const stateFor = (doc: PMNode) => EditorState.create({ schema, doc, plugins })

  const view = new EditorView(mount, {
    state: stateFor(N.doc.create(null, N.paragraph.create())),
    nodeViews: nodeViews(),
    attributes: { spellcheck: 'false', class: 'md-editor' },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr))
      if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) hooks.onChange(view)
    },
  })

  return {
    view,
    load(doc) {
      view.updateState(stateFor(doc))
      hooks.onChange(view)
    },
    refreshImages() {
      view.setProps({ nodeViews: nodeViews() })
    },
  }
}
