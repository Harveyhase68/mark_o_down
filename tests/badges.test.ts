import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, configText, defaultValues, fillTemplate, parseConfig, searchIcons, titleToSlug, type IconEntry } from '../src/badges/config'

describe('badge templates', () => {
  it('fills a shields static badge with escaping and drops empty params', () => {
    const url = fillTemplate('https://img.shields.io/badge/{label|shields}-{message|shields}-{color|hex}?style={style}&logo={logo}', {
      label: 'Made with',
      message: 'C-sharp_7',
      color: '#ff8800',
      style: 'flat',
      logo: '',
    })
    expect(url).toBe('https://img.shields.io/badge/Made%20with-C--sharp__7-ff8800?style=flat')
  })

  it('keeps raw path segments', () => {
    expect(fillTemplate('https://img.shields.io/github/stars/{repo|raw}', { repo: 'tauri-apps/tauri' })).toBe('https://img.shields.io/github/stars/tauri-apps/tauri')
  })

  it('every default template produces a valid https URL', () => {
    for (const p of DEFAULT_CONFIG.providers) {
      for (const t of p.templates) {
        const url = fillTemplate(t.url, defaultValues(t))
        expect(() => new URL(url), `${p.id}/${t.id}`).not.toThrow()
        expect(url.startsWith('https://')).toBe(true)
        expect(url).not.toMatch(/[{}]/)
      }
    }
  })

  it('the default config survives a save/load cycle', () => {
    expect(parseConfig(configText(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG)
  })

  it('rejects broken configs with a readable message', () => {
    expect(() => parseConfig('{"providers": 1}')).toThrow(/providers/)
  })
})

describe('icon search', () => {
  const icons: IconEntry[] = ['Rust', 'Rust Desk', 'TrustPilot', 'React', '.NET', 'Node.js'].map((title) => ({ title, slug: titleToSlug(title), hex: '000000', aliases: title === 'React' ? ['ReactJS'] : [] }))

  it('derives Simple Icons slugs', () => {
    expect(titleToSlug('.NET')).toBe('dotnet')
    expect(titleToSlug('Node.js')).toBe('nodedotjs')
  })

  it('ranks exact, then prefix, then substring, then aliases', () => {
    expect(searchIcons(icons, 'rust').map((i) => i.title)).toEqual(['Rust', 'Rust Desk', 'TrustPilot'])
    expect(searchIcons(icons, 'reactjs').map((i) => i.title)).toEqual(['React'])
  })
})
