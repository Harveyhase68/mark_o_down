// `$math$` syntax, like remark-math – but single dollars follow Pandoc's rule, so
// prices stay text ("from $5 to $10"):
//   • the opening `$` is followed by a non-space,
//   • the closing `$` follows a non-space and is not followed by a digit.
// `$$…$$` inline and `$$` blocks work as in remark-math.
//
// The inline tokenizer is micromark-extension-math's `mathText` (MIT, © Titus Wormer)
// with those checks added.

import type { Processor } from 'unified'
import type { Code, Construct, Effects, Event, State, TokenizeContext } from 'micromark-util-types'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown } from 'mdast-util-math'

const DOLLAR = 36
const SPACE = 32
const isLineEnding = (code: Code) => code !== null && code < -2
const isSpace = (code: Code) => code === SPACE || code === -2 || code === -1 || isLineEnding(code) // space, tab (virtual/horizontal), line ending
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57

function previous(this: TokenizeContext, code: Code): boolean {
  return code !== DOLLAR || this.events[this.events.length - 1][1].type === 'characterEscape'
}

function tokenizeMathText(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let sizeOpen = 0
  let size = 0
  let lastWasSpace = false
  let token: ReturnType<Effects['enter']>

  const start: State = (code) => {
    effects.enter('mathText')
    effects.enter('mathTextSequence')
    return sequenceOpen(code)
  }

  const sequenceOpen: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code)
      sizeOpen++
      return sequenceOpen
    }
    // Pandoc: `$ x$` is not math
    if (sizeOpen === 1 && (code === null || isSpace(code))) return nok(code)
    effects.exit('mathTextSequence')
    return between(code)
  }

  const between: State = (code) => {
    if (code === null) return nok(code)
    if (code === DOLLAR) {
      token = effects.enter('mathTextSequence')
      size = 0
      return sequenceClose(code)
    }
    if (code === SPACE) {
      effects.enter('space')
      effects.consume(code)
      effects.exit('space')
      lastWasSpace = true
      return between
    }
    if (isLineEnding(code)) {
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      lastWasSpace = true
      return between
    }
    effects.enter('mathTextData')
    return data(code)
  }

  const data: State = (code) => {
    if (code === null || code === SPACE || code === DOLLAR || isLineEnding(code)) {
      effects.exit('mathTextData')
      return between(code)
    }
    effects.consume(code)
    lastWasSpace = false
    return data
  }

  const sequenceClose: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code)
      size++
      return sequenceClose
    }
    // Pandoc: `$x $` and `$x$5` do not close
    const closes = size === sizeOpen && !(sizeOpen === 1 && (lastWasSpace || isDigit(code)))
    if (closes) {
      effects.exit('mathTextSequence')
      effects.exit('mathText')
      return ok(code)
    }
    token.type = 'mathTextData'
    lastWasSpace = false
    return data(code)
  }

  return start
}

/** Unchanged from micromark-extension-math: padding and line endings inside inline math. */
function resolveMathText(events: Event[]): Event[] {
  let tailExitIndex = events.length - 4
  let headEnterIndex = 3
  let index: number
  let enter: number | undefined

  if (
    (events[headEnterIndex][1].type === 'lineEnding' || events[headEnterIndex][1].type === 'space') &&
    (events[tailExitIndex][1].type === 'lineEnding' || events[tailExitIndex][1].type === 'space')
  ) {
    index = headEnterIndex
    while (++index < tailExitIndex) {
      if (events[index][1].type === 'mathTextData') {
        events[tailExitIndex][1].type = 'mathTextPadding'
        events[headEnterIndex][1].type = 'mathTextPadding'
        headEnterIndex += 2
        tailExitIndex -= 2
        break
      }
    }
  }

  index = headEnterIndex - 1
  tailExitIndex++
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      if (index !== tailExitIndex && events[index][1].type !== 'lineEnding') enter = index
    } else if (index === tailExitIndex || events[index][1].type === 'lineEnding') {
      events[enter][1].type = 'mathTextData'
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end
        events.splice(enter + 2, index - enter - 2)
        tailExitIndex -= index - enter - 2
        index = enter + 2
      }
      enter = undefined
    }
  }
  return events
}

const mathText: Construct = { name: 'mathText', tokenize: tokenizeMathText, resolve: resolveMathText, previous }

/** unified plugin: parse `$…$` / `$$…$$` into mdast `inlineMath` / `math`. */
export function remarkMath(this: Processor) {
  const data = this.data() as { micromarkExtensions?: unknown[]; fromMarkdownExtensions?: unknown[] }
  ;(data.micromarkExtensions ??= []).push({ flow: math().flow, text: { [DOLLAR]: mathText } })
  ;(data.fromMarkdownExtensions ??= []).push(mathFromMarkdown())
}
