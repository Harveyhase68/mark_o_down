import { describe, expect, it } from 'vitest'
import { de } from '../src/i18n/de'
import { en } from '../src/i18n/en'
import { fr } from '../src/i18n/fr'
import { es } from '../src/i18n/es'
import { it as itDict } from '../src/i18n/it'
import { _setLangForTests, kbd, t, type MessageKey } from '../src/i18n'

const OTHERS = { en, fr, es, it: itDict }
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  for (const [lang, dict] of Object.entries(OTHERS)) {
    it(`${lang}: every text is present and has the same placeholders as German`, () => {
      for (const key of Object.keys(de) as MessageKey[]) {
        expect(dict[key], `${lang} ${key}`).toBeTruthy()
        expect(placeholders(dict[key]), `${lang} ${key}`).toEqual(placeholders(de[key]))
      }
      expect(Object.keys(dict).sort()).toEqual(Object.keys(de).sort())
    })
  }

  it('shows macOS shortcuts with symbols and Cmd', () => {
    expect(kbd('Ctrl+Shift+S', true)).toBe('⇧⌘S')
    expect(kbd('Ctrl+Alt', true)).toBe('⌥⌘')
    expect(kbd('Ctrl+Enter', true)).toBe('⌘↩')
    expect(kbd('F3', true)).toBe('F3')
  })

  it('fills placeholders and localises shortcuts', () => {
    _setLangForTests('de')
    expect(t('save.question', { name: 'README.md' })).toBe('Änderungen an „README.md“ speichern?')
    expect(kbd('Ctrl+Shift+S', false)).toBe('Strg+Umschalt+S')
    _setLangForTests('fr')
    expect(kbd('Ctrl+Shift+S', false)).toBe('Ctrl+Maj+S')
    expect(t('find.count', { current: 3, total: 12 })).toBe('3 sur 12')
    _setLangForTests('en')
    expect(t('find.count', { current: 3, total: 12 })).toBe('3 of 12')
    _setLangForTests('de')
  })
})
