import { describe, expect, it } from 'vitest'
import { readRecoverySet } from '../src/platform'

describe('recovery file', () => {
  const one = { path: 'C:\\a.md', markdown: '# A', eol: 'lf', bom: false, diskHash: 'x', savedAt: 5, session: true, cursor: 3, scroll: 10 }

  it('the file of a version before tabs: one document', () => {
    expect(readRecoverySet(one)).toEqual({ version: 2, tabs: [one], active: 0, savedAt: 5, session: true })
  })

  it('all tabs; a front tab out of range is clamped, junk is ignored', () => {
    const set = readRecoverySet({ version: 2, tabs: [one, { ...one, path: null, markdown: null }, 7], active: 9, savedAt: 6 })
    expect(set?.tabs).toHaveLength(2)
    expect(set?.active).toBe(1)
    expect(set?.session).toBe(false)
    expect(readRecoverySet('nonsense')).toBeNull()
    expect(readRecoverySet({ foo: 1 })).toBeNull()
  })
})
