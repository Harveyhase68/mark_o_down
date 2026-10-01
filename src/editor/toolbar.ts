import type { EditorView } from 'prosemirror-view'
import type { Command, EditorState } from 'prosemirror-state'
import { setBlockType, toggleMark } from 'prosemirror-commands'
import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history'
import { schema } from '../md/schema'
import { openMenu, type MenuItem } from './dialog'
import { LANGUAGES, getLang, kbd, setLang, t, type MessageKey } from '../i18n'
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
import { insertFootnote } from './footnotes'
import { insertMath } from './math'

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
  sup: svg('<path d="m4 8 8 11M12 8l-8 11M16 4.5a2 2 0 0 1 4 .5c0 1.5-4 2.5-4 4.5h4"/>'),
  sub: svg('<path d="m4 5 8 11M12 5 4 16M16 15.5a2 2 0 0 1 4 .5c0 1.5-4 2.5-4 4.5h4"/>'),
  highlight: svg('<path d="m9 11-5 5v3h3l5-5M9 11l4-7 7 7-7 4z"/><path d="M4 21h16" opacity=".45" stroke-width="3"/>'),
  math: svg('<path d="M18 5H6l6 7-6 7h12"/>'),
  footnote: svg('<path d="M4 7h10M4 12h10M4 17h6"/><path d="M18 4v6M16.5 5.5 18 4" stroke-width="1.8"/>'),
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
  /** "Remember session" (only in the app, not in the browser preview). */
  session?: { enabled: () => boolean; toggle: () => void }
  /** Extended syntax on/off (the toolbar is rebuilt after a change). */
  extended: { enabled: () => boolean; toggle: () => void }
}

/** Builds (or rebuilds, e.g. after a language change) the toolbar into `el`. */
export function createToolbar(el: HTMLElement, view: EditorView, actions: ToolbarActions) {
  const ext = actions.extended.enabled()
  el.replaceChildren()
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

  /** "Fett (Strg+B)" – name in the current language plus the localised shortcut. */
  const tip = (key: MessageKey, shortcut?: string) => (shortcut ? `${t(key)} (${kbd(shortcut)})` : t(key))

  const groups: (Group | 'heading')[] = ([
    [
      { id: 'open', title: tip('tb.open', 'Ctrl+O'), menu: () => actions.openMenu() },
      {
        id: 'save',
        title: t('tb.save'),
        menu: () => [
          { label: t('common.save'), shortcut: kbd('Ctrl+S'), run: actions.save },
          { label: t('common.saveAs'), shortcut: kbd('Ctrl+Shift+S'), run: actions.saveAs },
          'separator',
          { label: t('menu.exportHtml'), shortcut: kbd('Ctrl+Shift+E'), run: actions.exportHtml },
          { label: t('menu.copyHtml'), run: actions.copyHtml },
        ],
      },
      { id: 'close', title: tip('tb.close', 'Ctrl+W'), action: () => actions.close() },
      { id: 'print', title: tip('tb.print', 'Ctrl+P'), action: () => actions.print() },
    ],
    [
      { id: 'undo', title: tip('tb.undo', 'Ctrl+Z'), cmd: undo, enabled: (s) => undoDepth(s) > 0 },
      { id: 'redo', title: tip('tb.redo', 'Ctrl+Y'), cmd: redo, enabled: (s) => redoDepth(s) > 0 },
    ],
    'heading',
    [
      { id: 'bold', title: tip('tb.bold', 'Ctrl+B'), cmd: toggleMark(K.strong), active: (s) => markActive(s, K.strong) },
      { id: 'italic', title: tip('tb.italic', 'Ctrl+I'), cmd: toggleMark(K.em), active: (s) => markActive(s, K.em) },
      { id: 'strike', title: tip('tb.strike', 'Ctrl+Shift+X'), cmd: toggleMark(K.strike), active: (s) => markActive(s, K.strike) },
      { id: 'code', title: tip('tb.code', 'Ctrl+E'), cmd: toggleMark(K.code), active: (s) => markActive(s, K.code) },
      // written as ^x^ / ~x~ / ==x== with the extended syntax, else as HTML tags (GitHub)
      { id: 'sup', title: `${t('tb.sup')} (${ext ? '^x^' : '<sup>'})`, cmd: toggleMark(K.sup, { md: ext }), active: (s) => markActive(s, K.sup) },
      { id: 'sub', title: `${t('tb.sub')} (${ext ? '~x~' : '<sub>'})`, cmd: toggleMark(K.sub, { md: ext }), active: (s) => markActive(s, K.sub) },
      { id: 'highlight', title: `${t('tb.highlight')} (${ext ? '==x==' : '<mark>'})`, cmd: toggleMark(K.highlight, { md: ext }), active: (s) => markActive(s, K.highlight) },
    ],
    [
      { id: 'bullet', title: tip('tb.bullet', 'Ctrl+Shift+8'), cmd: toggleList(N.bullet_list), active: inList(N.bullet_list) },
      { id: 'ordered', title: tip('tb.ordered', 'Ctrl+Shift+7'), cmd: toggleList(N.ordered_list), active: inList(N.ordered_list) },
      { id: 'task', title: tip('tb.task'), cmd: toggleTask, active: inTask },
      { id: 'quote', title: tip('tb.quote', 'Ctrl+Shift+9'), cmd: toggleBlockquote(), active: inNode(N.blockquote) },
      { id: 'center', title: tip('tb.center'), cmd: toggleCenter, active: inCenter },
    ],
    [
      { id: 'link', title: tip('tb.link', 'Ctrl+K'), action: (v) => actions.link(v), active: (s) => markActive(s, K.link) },
      { id: 'image', title: tip('tb.image'), action: (v) => actions.image(v) },
      { id: 'emoji', title: tip('tb.emoji', 'Ctrl+.'), action: (v) => actions.emoji(v) },
      { id: 'codeblock', title: tip('tb.codeblock'), cmd: toggleCodeBlock },
      { id: 'math', title: tip('tb.math'), action: (v) => void insertMath(v), active: (s) => inNode(N.math_block)(s) },
      { id: 'footnote', title: tip('tb.footnote', 'Ctrl+Alt+F'), cmd: insertFootnote },
      { id: 'hr', title: tip('tb.hr'), cmd: insertRule },
      { id: 'table', title: tip('tb.table'), cmd: insertTable(), enabled: (s) => !isInTable(s) },
    ],
    [
      { id: 'find', title: `${t('tb.find')} (${kbd('Ctrl+F')} / ${kbd('Ctrl+H')})`, action: () => actions.find() },
      { id: 'source', title: tip('tb.source', 'Ctrl+Shift+M'), action: () => actions.toggleSource(), active: () => actions.sourceVisible() },
    ],
  ] as (Button[] | 'heading')[]).map((g) => (g === 'heading' ? g : { buttons: g }))

  // Table tools, only shown while the cursor is in a table
  groups.push({
    visible: isInTable,
    buttons: [
      { id: 'rowBefore', title: tip('tb.rowBefore'), cmd: addRowBefore },
      { id: 'rowAfter', title: tip('tb.rowAfter'), cmd: addRowAfter },
      { id: 'colBefore', title: tip('tb.colBefore'), cmd: addColumnBefore },
      { id: 'colAfter', title: tip('tb.colAfter'), cmd: addColumnAfter },
      { id: 'delRow', title: tip('tb.delRow'), cmd: deleteRow },
      { id: 'delCol', title: tip('tb.delCol'), cmd: deleteColumn },
      { id: 'alignLeft', title: tip('tb.alignLeft'), cmd: alignColumn('left'), active: (s) => columnAlign(s) === 'left' },
      { id: 'alignCenter', title: tip('tb.alignCenter'), cmd: alignColumn('center'), active: (s) => columnAlign(s) === 'center' },
      { id: 'alignRight', title: tip('tb.alignRight'), cmd: alignColumn('right'), active: (s) => columnAlign(s) === 'right' },
      { id: 'delTable', title: tip('tb.delTable'), cmd: deleteTable },
    ],
  })

  const buttons: { btn: HTMLButtonElement; def: Button }[] = []
  const groupEls: { el: HTMLElement; group: Group }[] = []
  let select!: HTMLSelectElement

  // Help (with the language switch), always at the far right
  groups.push({
    right: true,
    buttons: [
      {
        id: 'help',
        title: t('tb.help'),
        menu: () => [
          { label: t('menu.help'), shortcut: 'F1', run: actions.help },
          'separator',
          {
            label: `${ext ? '✓' : ' '}  ${t('menu.extended')}`,
            title: t('menu.extendedTip'),
            run: actions.extended.toggle,
          },
          ...(actions.session
            ? [
                {
                  label: `${actions.session.enabled() ? '✓' : ' '}  ${t('menu.session')}`,
                  title: t('menu.sessionTip'),
                  run: actions.session.toggle,
                },
                'separator' as const,
              ]
            : []),
          { label: `${t('menu.language')} / Language`, disabled: true, run: () => {} },
          ...LANGUAGES.map((l) => ({
            label: `${l.code === getLang() ? '✓' : ' '}  ${l.name}`,
            shortcut: l.code.toUpperCase(),
            run: () => setLang(l.code),
          })),
          'separator',
          { label: t('menu.about'), run: actions.about },
        ],
      },
    ],
  })

  for (const group of groups) {
    const g = document.createElement('div')
    g.className = group !== 'heading' && group.right ? 'tb-group tb-right' : 'tb-group'
    if (group === 'heading') {
      select = document.createElement('select')
      select.title = `${t('tb.blockFormat')} (${kbd('Ctrl+Alt')}+0…3)`
      select.innerHTML =
        `<option value="0">${t('tb.paragraph')}</option>` +
        [1, 2, 3, 4, 5, 6].map((l) => `<option value="${l}">${t('tb.heading', { n: l })}</option>`).join('') +
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
