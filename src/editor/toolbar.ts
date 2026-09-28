import type { EditorView } from 'prosemirror-view'
import type { Command, EditorState } from 'prosemirror-state'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history'
import { schema } from '../md/schema'
import { openMenu, type MenuItem } from './dialog'
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable } from 'prosemirror-tables'
import {
  alignColumn,
  columnAlign,
  currentBlockLevel,
  currentList,
  inCenter,
  insertRule,
  insertTable,
  markActive,
  setHeading,
  toggleBlockquote,
  toggleCenter,
  toggleList,
  toggleTask,
} from './commands'

const N = schema.nodes
const K = schema.marks

// 24×24 stroke icons
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS: Record<string, string> = {
  close: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9.5 12.5l5 5M14.5 12.5l-5 5"/>'),
  print: svg('<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17h.01"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: svg('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  bold: svg('<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>'),
  italic: svg('<path d="M14 4h-4M14 20h-4M15 4 9 20"/>'),
  strike: svg('<path d="M4 12h16M16 6.5A4 3 0 0 0 12 4c-2.5 0-4 1.3-4 3 0 1.3.8 2.3 2.5 3M8 17.5A4 3 0 0 0 12 20c2.5 0 4-1.3 4-3 0-.7-.2-1.3-.6-1.8"/>'),
  code: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>'),
  bullet: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
  ordered: svg('<path d="M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M6 18H4l2-2.5a1.2 1.2 0 0 0-2-1"/>'),
  task: svg('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4.5 16 1.5 1.5 3-3M13 7h8M13 16h8"/>'),
  quote: svg('<path d="M4 18V11a5 5 0 0 1 5-5M13 18v-7a5 5 0 0 1 5-5"/><path d="M4 18h5v-5H4M13 18h5v-5h-5"/>'),
  codeblock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 10-2 2 2 2M15 10l2 2-2 2"/>'),
  hr: svg('<path d="M3 12h18"/><path d="M8 7h8M8 17h8" opacity=".35"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  center: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  rowBefore: svg('<rect x="3" y="12" width="18" height="8" rx="1"/><path d="M12 3v6M9 6h6"/>'),
  rowAfter: svg('<rect x="3" y="4" width="18" height="8" rx="1"/><path d="M12 15v6M9 18h6"/>'),
  colBefore: svg('<rect x="12" y="3" width="8" height="18" rx="1"/><path d="M3 12h6M6 9v6"/>'),
  colAfter: svg('<rect x="4" y="3" width="8" height="18" rx="1"/><path d="M15 12h6M18 9v6"/>'),
  delRow: svg('<rect x="3" y="8" width="18" height="8" rx="1"/><path d="m9 10 6 4M15 10l-6 4"/>'),
  delCol: svg('<rect x="8" y="3" width="8" height="18" rx="1"/><path d="m10 9 4 6M14 9l-4 6"/>'),
  alignLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  delTable: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/><path d="m13 13 6 6M19 13l-6 6" stroke-width="2.4"/>'),
  emoji: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/>'),
  find: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'),
  source: svg('<path d="M14 4 10 20M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
}

interface Button {
  /** Opens a dropdown menu instead of running a command. */
  menu?: () => MenuItem[]
  id: string
  title: string
  cmd?: Command
  action?: (view: EditorView) => void
  active?: (s: EditorState) => boolean
  enabled?: (s: EditorState) => boolean
}

/** A button group; `visible` hides the whole group (e.g. table tools outside tables). */
interface Group {
  buttons: Button[]
  visible?: (s: EditorState) => boolean
  /** Pushed to the right end of the toolbar. */
  right?: boolean
}

export interface ToolbarActions {
  open: () => void
  /** Öffnen… + recently opened files */
  openMenu: () => MenuItem[]
  save: () => void
  saveAs: () => void
  close: () => void
  print: () => void
  exportHtml: () => void
  copyHtml: () => void
  help: () => void
  about: () => void
  link: (view: EditorView) => void
  image: (view: EditorView) => void
  emoji: (view: EditorView) => void
  find: () => void
  toggleSource: () => void
  sourceVisible: () => boolean
}

export function createToolbar(el: HTMLElement, view: EditorView, actions: ToolbarActions) {
  const inList = (type: typeof N.bullet_list) => (s: EditorState) => currentList(s)?.node.type === type
  const inNode = (type: typeof N.blockquote) => (s: EditorState) => {
    const { $from } = s.selection
    for (let d = $from.depth; d >= 0; d--) if ($from.node(d).type === type) return true
    return false
  }
  const inTask = (s: EditorState) => {
    const { $from } = s.selection
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.list_item) return $from.node(d).attrs.checked !== null
    return false
  }

  const groups: (Group | 'heading')[] = ([
    [
      { id: 'open', title: 'Öffnen (Strg+O), zuletzt geöffnete Dateien', menu: () => actions.openMenu() },
      {
        id: 'save',
        title: 'Speichern, Speichern unter…, HTML-Export',
        menu: () => [
          { label: 'Speichern', shortcut: 'Strg+S', run: actions.save },
          { label: 'Speichern unter…', shortcut: 'Strg+Umschalt+S', run: actions.saveAs },
          'separator',
          { label: 'Als HTML exportieren…', shortcut: 'Strg+Umschalt+E', run: actions.exportHtml },
          { label: 'HTML in die Zwischenablage kopieren', run: actions.copyHtml },
        ],
      },
      { id: 'close', title: 'Dokument schließen (Strg+W)', action: () => actions.close() },
      { id: 'print', title: 'Drucken (Strg+P)', action: () => actions.print() },
    ],
    [
      { id: 'undo', title: 'Rückgängig (Strg+Z)', cmd: undo, enabled: (s) => undoDepth(s) > 0 },
      { id: 'redo', title: 'Wiederholen (Strg+Y)', cmd: redo, enabled: (s) => redoDepth(s) > 0 },
    ],
    'heading',
    [
      { id: 'bold', title: 'Fett (Strg+B)', cmd: toggleMark(K.strong), active: (s) => markActive(s, K.strong) },
      { id: 'italic', title: 'Kursiv (Strg+I)', cmd: toggleMark(K.em), active: (s) => markActive(s, K.em) },
      { id: 'strike', title: 'Durchgestrichen (Strg+Umschalt+X)', cmd: toggleMark(K.strike), active: (s) => markActive(s, K.strike) },
      { id: 'code', title: 'Code (Strg+E)', cmd: toggleMark(K.code), active: (s) => markActive(s, K.code) },
    ],
    [
      { id: 'bullet', title: 'Aufzählung (Strg+Umschalt+8)', cmd: toggleList(N.bullet_list), active: inList(N.bullet_list) },
      { id: 'ordered', title: 'Nummerierung (Strg+Umschalt+7)', cmd: toggleList(N.ordered_list), active: inList(N.ordered_list) },
      { id: 'task', title: 'Aufgabe [ ] (in Listen)', cmd: toggleTask, active: inTask },
      { id: 'quote', title: 'Zitat (Strg+Umschalt+9)', cmd: toggleBlockquote(), active: inNode(N.blockquote) },
      { id: 'center', title: 'Zentrieren (<div align="center">)', cmd: toggleCenter, active: inCenter },
    ],
    [
      { id: 'link', title: 'Link (Strg+K)', action: (v) => actions.link(v), active: (s) => markActive(s, K.link) },
      { id: 'image', title: 'Bild, Badge oder Icon', action: (v) => actions.image(v) },
      { id: 'emoji', title: 'Emoji & Zeichen (Strg+.)', action: (v) => actions.emoji(v) },
      { id: 'codeblock', title: 'Codeblock', cmd: toggleCodeBlock },
      { id: 'hr', title: 'Trennlinie', cmd: insertRule },
      { id: 'table', title: 'Tabelle einfügen', cmd: insertTable(), enabled: (s) => !isInTable(s) },
    ],
    [
      { id: 'find', title: 'Suchen & Ersetzen (Strg+F / Strg+H)', action: () => actions.find() },
      { id: 'source', title: 'Markdown-Quelltext anzeigen (Strg+Umschalt+M)', action: () => actions.toggleSource(), active: () => actions.sourceVisible() },
    ],
  ] as (Button[] | 'heading')[]).map((g) => (g === 'heading' ? g : { buttons: g }))

  // Table tools, only shown while the cursor is in a table
  groups.push({
    visible: isInTable,
    buttons: [
      { id: 'rowBefore', title: 'Zeile oberhalb einfügen', cmd: addRowBefore },
      { id: 'rowAfter', title: 'Zeile unterhalb einfügen', cmd: addRowAfter },
      { id: 'colBefore', title: 'Spalte links einfügen', cmd: addColumnBefore },
      { id: 'colAfter', title: 'Spalte rechts einfügen', cmd: addColumnAfter },
      { id: 'delRow', title: 'Zeile löschen', cmd: deleteRow },
      { id: 'delCol', title: 'Spalte löschen', cmd: deleteColumn },
      { id: 'alignLeft', title: 'Spalte linksbündig', cmd: alignColumn('left'), active: (s) => columnAlign(s) === 'left' },
      { id: 'alignCenter', title: 'Spalte zentriert', cmd: alignColumn('center'), active: (s) => columnAlign(s) === 'center' },
      { id: 'alignRight', title: 'Spalte rechtsbündig', cmd: alignColumn('right'), active: (s) => columnAlign(s) === 'right' },
      { id: 'delTable', title: 'Tabelle löschen', cmd: deleteTable },
    ],
  })

  const buttons: { btn: HTMLButtonElement; def: Button }[] = []
  const groupEls: { el: HTMLElement; group: Group }[] = []
  let select!: HTMLSelectElement

  // Help, always at the far right
  groups.push({
    right: true,
    buttons: [
      {
        id: 'help',
        title: 'Hilfe',
        menu: () => [{ label: 'Hilfe…', shortcut: 'F1', run: actions.help }, 'separator', { label: 'Über Mark O Down', run: actions.about }],
      },
    ],
  })

  for (const group of groups) {
    const g = document.createElement('div')
    g.className = group !== 'heading' && group.right ? 'tb-group tb-right' : 'tb-group'
    if (group === 'heading') {
      select = document.createElement('select')
      select.title = 'Absatzformat (Strg+Alt+0…3)'
      select.innerHTML =
        '<option value="0">Absatz</option>' +
        [1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}">Überschrift ${l}</option>`).join('') +
        '<option value="-1" disabled hidden>—</option>'
      select.onchange = () => {
        setHeading(+select.value)(view.state, view.dispatch)
        view.focus()
      }
      g.append(select)
    } else {
      if (group.visible) groupEls.push({ el: g, group })
      for (const def of group.buttons) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'tb-btn'
        btn.title = def.title
        btn.setAttribute('aria-label', def.title)
        btn.innerHTML = ICONS[def.id]
        btn.onmousedown = (e) => e.preventDefault() // keep editor selection
        if (def.menu) {
          btn.classList.add('has-menu')
          btn.onclick = () => openMenu(btn, def.menu!())
          g.append(btn)
          buttons.push({ btn, def })
          continue
        }
        btn.onclick = () => {
          // an alignment button that is already active resets the column to "no alignment"
          if (def.id.startsWith('align') && def.active?.(view.state)) alignColumn(null)(view.state, view.dispatch)
          else if (def.cmd) def.cmd(view.state, view.dispatch, view)
          else def.action!(view)
          if (def.id !== 'source') view.focus()
          update()
        }
        g.append(btn)
        buttons.push({ btn, def })
      }
    }
    el.append(g)
  }

  function update() {
    const s = view.state
    for (const { btn, def } of buttons) {
      btn.classList.toggle('active', def.active?.(s) ?? false)
      btn.disabled = def.enabled ? !def.enabled(s) : false
    }
    for (const { el, group } of groupEls) el.hidden = !group.visible!(s)
    const level = currentBlockLevel(s)
    select.value = String(level ?? -1)
    select.disabled = level === null
  }

  update()
  return { update }
}

const toggleCodeBlock: Command = (state, dispatch) =>
  state.selection.$from.parent.type === N.code_block ? setHeading(0)(state, dispatch) : setBlockType(N.code_block)(state, dispatch)
