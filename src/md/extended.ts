// "Extended syntax" (Pandoc / Typora / Obsidian), switchable – GitHub shows these as text:
//   ^sup^   ~sub~   ==highlight==   and definition lists (`Term` / `: Definition`).
// With it on, a single `~` is subscript, not strikethrough (`~~x~~` stays strikethrough).
//
// The inline tokenizer follows micromark-extension-gfm-strikethrough (MIT, © Titus
// Wormer): delimiter runs that open/close like emphasis. Pandoc's rule for super- and
// subscript: no whitespace inside (`^a b^` is no superscript).

import type { Code, Construct, Effects, Event, Extension, State, Token, TokenizeContext } from 'micromark-util-types'
import type { Extension as FromMarkdownExtension, Handle as FromHandle } from 'mdast-util-from-markdown'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import type { PhrasingContent } from 'mdast'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import { splice } from 'micromark-util-chunked'
import { defList } from 'micromark-extension-definition-list'
import { defListFromMarkdown, defListToMarkdown } from 'mdast-util-definition-list'

interface Delimiter {
  /** micromark token / mdast node name */
  name: 'superscript' | 'subscript' | 'mark'
  marker: number
  char: string
  size: number
  /** Pandoc: no whitespace inside */
  noSpace: boolean
  /** HTML tag (rendering, and the fallback when the Markdown form can't hold the content) */
  tag: string
}

export const DELIMITERS: Delimiter[] = [
  { name: 'superscript', marker: 94, char: '^', size: 1, noSpace: true, tag: 'sup' },
  { name: 'subscript', marker: 126, char: '~', size: 1, noSpace: true, tag: 'sub' },
  { name: 'mark', marker: 61, char: '=', size: 2, noSpace: false, tag: 'mark' },
]

const ATTENTION_SIDE_AFTER = 2 // micromark-util-symbol constants.attentionSideAfter

interface DelimiterToken extends Token {
  _open?: boolean
  _close?: boolean
}

function delimiterConstruct(d: Delimiter): Construct {
  const temporary = `${d.name}SequenceTemporary`

  function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const previous = this.previous
    const events = this.events
    let size = 0

    const start: State = (code: Code) => {
      // not in the middle of a run (`~~` is strikethrough, `===` nothing)
      if (previous === d.marker && events[events.length - 1][1].type !== 'characterEscape') return nok(code)
      effects.enter(temporary as never)
      return more(code)
    }

    const more: State = (code: Code) => {
      const before = classifyCharacter(previous)
      if (code === d.marker) {
        if (size >= d.size) return nok(code)
        effects.consume(code)
        size++
        return more
      }
      if (size !== d.size) return nok(code)
      const token = effects.exit(temporary as never) as DelimiterToken
      const after = classifyCharacter(code)
      token._open = !after || (after === ATTENTION_SIDE_AFTER && Boolean(before))
      token._close = !before || (before === ATTENTION_SIDE_AFTER && Boolean(after))
      return ok(code)
    }

    return start
  }

  function resolveAllDelimiter(events: Event[], context: TokenizeContext): Event[] {
    let index = -1
    while (++index < events.length) {
      const closer = events[index][1] as DelimiterToken
      if (events[index][0] !== 'enter' || closer.type !== temporary || !closer._close) continue
      let open = index
      while (open--) {
        const opener = events[open][1] as DelimiterToken
        if (events[open][0] !== 'exit' || opener.type !== temporary || !opener._open) continue
        const inner = context.sliceSerialize({ start: opener.end, end: closer.start } as Token)
        if (!inner || (d.noSpace && /\s/.test(inner))) break
        opener.type = `${d.name}Sequence` as never
        closer.type = `${d.name}Sequence` as never
        const span = { type: d.name, start: { ...opener.start }, end: { ...closer.end } } as unknown as Token
        const text = { type: `${d.name}Text`, start: { ...opener.end }, end: { ...closer.start } } as unknown as Token
        const nextEvents: Event[] = [
          ['enter', span, context],
          ['enter', opener, context],
          ['exit', opener, context],
          ['enter', text, context],
        ]
        const insideSpan = context.parser.constructs.insideSpan.null
        if (insideSpan) splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context))
        splice(nextEvents, nextEvents.length, 0, [
          ['exit', text, context],
          ['enter', closer, context],
          ['exit', closer, context],
          ['exit', span, context],
        ])
        splice(events, open - 1, index - open + 3, nextEvents)
        index = open + nextEvents.length - 2
        break
      }
    }
    for (const e of events) if (e[1].type === temporary) e[1].type = 'data'
    return events
  }

  return { name: d.name, tokenize, resolveAll: resolveAllDelimiter }
}

/** micromark syntax: the three delimiters and definition lists. */
export function extendedSyntax(): Extension[] {
  const constructs = DELIMITERS.map(delimiterConstruct)
  return [
    {
      text: Object.fromEntries(DELIMITERS.map((d, i) => [d.marker, constructs[i]])),
      insideSpan: { null: constructs },
      attentionMarkers: { null: DELIMITERS.map((d) => d.marker) },
    } as Extension,
    defList,
  ]
}

/** mdast: `superscript` / `subscript` / `mark` nodes (rendered as <sup>/<sub>/<mark>), definition lists. */
export function extendedFromMarkdown(): FromMarkdownExtension[] {
  const enter: Record<string, FromHandle> = {}
  const exit: Record<string, FromHandle> = {}
  for (const d of DELIMITERS) {
    enter[d.name] = function (token) {
      this.enter({ type: d.name, children: [], data: { hName: d.tag } } as never, token)
    }
    exit[d.name] = function (token) {
      this.exit(token)
    }
  }
  return [{ enter, exit }, defListFromMarkdown as FromMarkdownExtension]
}

/** Serialize the delimiters; content the Markdown form can't hold (spaces in ^…^) gets the HTML tag. */
function delimiterHandler(d: Delimiter): Handle {
  const fence = d.char.repeat(d.size)
  const handle: Handle = (node, _parent, state, info) => {
    const exit = state.enter(d.name as never)
    const inner = state.containerPhrasing(node as never, { ...info, before: fence, after: fence })
    exit()
    return !inner || (d.noSpace && /\s/.test(inner)) ? `<${d.tag}>${inner}</${d.tag}>` : fence + inner + fence
  }
  ;(handle as Handle & { peek: Handle }).peek = () => d.char
  return handle
}

/** A definition as `: Text` (the library writes `:   Text`); further lines indented to match. */
const defListDescription: Handle = (node, _parent, state, info) => {
  const exit = state.enter('defListDescription' as never)
  const value = state.indentLines(state.containerFlow(node as never, info), (line, index, blank) =>
    index ? (blank ? '' : '  ' + line) : blank ? ':' : ': ' + line,
  )
  exit()
  return value
}

/** to-markdown handlers (always: the editor may hold such nodes) … */
export const extendedHandlers: ToMarkdownOptions['handlers'] = {
  ...Object.fromEntries(DELIMITERS.map((d) => [d.name, delimiterHandler(d)])),
  ...defListToMarkdown.handlers,
  defListDescription,
}

/** … and, with the syntax on, escaping of `^` `~` `==` where a span could form, list joins. */
export const extendedToMarkdown: ToMarkdownOptions = {
  unsafe: [
    { character: '^', inConstruct: 'phrasing' },
    { character: '=', after: '=', inConstruct: 'phrasing' },
    ...(defListToMarkdown.unsafe ?? []),
  ],
  join: defListToMarkdown.join,
}

/** Characters that can't form a span in `text` (so they need no escaping); see markPlain in toMdast. */
export function plainChars(text: string, extended: boolean, couldFormMath: (t: string) => boolean): string {
  let plain = ''
  if (!couldFormMath(text)) plain += '$'
  if (extended && !/\^[^\s^]+\^/.test(text)) plain += '^'
  // `~` forms subscript (no spaces) with the extended syntax, else GFM strikethrough with one or two `~`
  const tilde = extended ? /(?<!~)~[^\s~]+~(?!~)|~~[^]*~~/.test(text) : (text.match(/~/g)?.length ?? 0) >= 2
  if (!tilde) plain += '~'
  if (extended && !/==[^]*==/.test(text)) plain += '='
  return plain
}

export type { PhrasingContent }

declare module 'mdast' {
  interface Superscript extends Parent {
    type: 'superscript'
    children: PhrasingContent[]
  }
  interface Subscript extends Parent {
    type: 'subscript'
    children: PhrasingContent[]
  }
  interface Mark extends Parent {
    type: 'mark'
    children: PhrasingContent[]
  }
  interface PhrasingContentMap {
    superscript: Superscript
    subscript: Subscript
    mark: Mark
  }
  interface RootContentMap {
    superscript: Superscript
    subscript: Subscript
    mark: Mark
  }
}
