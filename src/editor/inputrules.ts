// Markdown-style typing shortcuts: "# " → heading, "- " → list, **x** → bold, …

import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import type { MarkType } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { schema } from '../md/schema'
import { defListInputRule } from './deflist'

const N = schema.nodes
const K = schema.marks

/** `**text**` → text with `mark`. The delimiter must not be part of a longer run. */
function markRule(pattern: RegExp, type: MarkType, attrs: (m: RegExpMatchArray) => object | null = () => null): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[2]
    const lead = match[1] ?? ''
    if (!text || /^\s|\s$/.test(text)) return null
    const $start = state.doc.resolve(start)
    if ($start.parent.type.spec.code || K.code.isInSet($start.marks())) return null
    const from = start + lead.length
    const tr = state.tr.replaceWith(from, end, schema.text(text, [...$start.marks(), type.create(attrs(match))]))
    return tr.removeStoredMark(type)
  })
}

export function buildInputRules() {
  return inputRules({
    rules: [
      defListInputRule,
      textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, N.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list, (m) => ({ bullet: m[1] })),
      wrappingInputRule(
        /^(\d{1,9})([.)])\s$/,
        N.ordered_list,
        (m) => ({ start: +m[1], delim: m[2] }),
        (m, node) => node.childCount + node.attrs.start === +m[1],
      ),
      // `$$` or ```math + space: a formula block (GitHub renders both)
      textblockTypeInputRule(/^\$\$\s$/, N.math_block),
      textblockTypeInputRule(/^```math\s$/, N.math_block, { fence: '`' }),
      textblockTypeInputRule(/^```mermaid\s$/, N.mermaid_block),
      textblockTypeInputRule(/^```([\w+#-]*)\s$/, N.code_block, (m) => ({ lang: m[1] || null })),
      // "[ ] " / "[x] " at the start of a list item → task
      new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
        const $start = state.doc.resolve(start)
        const item = $start.depth >= 2 ? $start.node(-1) : null
        if (!item || item.type !== N.list_item || $start.index(-1) !== 0) return null
        return state.tr.delete(start, end).setNodeMarkup($start.before(-1), null, { ...item.attrs, checked: match[1] !== ' ' })
      }),
      new InputRule(/^(?:---|\*\*\*|___)$/, (state, _m, start, end) => {
        const $start = state.doc.resolve(start)
        if ($start.parent.type !== N.paragraph || $start.parent.childCount !== 1) return null
        const before = $start.before()
        const hr = N.horizontal_rule.create()
        const tr = state.tr.replaceWith(before, $start.after(), [hr, N.paragraph.create()])
        return tr.setSelection(TextSelection.create(tr.doc, before + hr.nodeSize + 1)).scrollIntoView()
      }),
      // ![alt](src "title") → image,  [text](href "title") → link
      new InputRule(/(^|[^\\])!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/, (state, m, start, end) => {
        if (state.doc.resolve(start).parent.type.spec.code) return null
        const from = start + m[1].length
        return state.tr.replaceWith(from, end, N.image.create({ alt: m[2], src: m[3], title: m[4] ?? null }))
      }),
      new InputRule(/(^|[^\\!])\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/, (state, m, start, end) => {
        const $start = state.doc.resolve(start)
        if ($start.parent.type.spec.code) return null
        const from = start + m[1].length
        const marks = [...$start.marks(), K.link.create({ href: m[3], title: m[4] ?? null })]
        return state.tr.replaceWith(from, end, schema.text(m[2], marks)).removeStoredMark(K.link)
      }),
      markRule(/(^|[^*\\])\*\*([^*]+)\*\*$/, K.strong),
      markRule(/(^|[^_\\\w])__([^_]+)__$/, K.strong, () => ({ marker: '_' })),
      markRule(/(^|[^*\\])\*([^*]+)\*$/, K.em),
      markRule(/(^|[^_\\\w])_([^_]+)_$/, K.em, () => ({ marker: '_' })),
      markRule(/(^|[^~\\])~~([^~]+)~~$/, K.strike),
      markRule(/(^|[^`\\])`([^`]+)`$/, K.code),
    ],
  })
}
