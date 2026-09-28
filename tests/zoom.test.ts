import { describe, expect, it } from 'vitest'
import { ZOOM_STEPS, nextZoom } from '../src/editor/zoom'

describe('zoom steps', () => {
  it('steps up and down through the list', () => {
    expect(nextZoom(1, 1)).toBe(1.1)
    expect(nextZoom(1, -1)).toBe(0.9)
    expect(nextZoom(1.25, 1)).toBe(1.5)
  })

  it('stops at the ends', () => {
    expect(nextZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(3)
    expect(nextZoom(ZOOM_STEPS[0], -1)).toBe(0.5)
  })

  it('snaps an odd level to the next step', () => {
    expect(nextZoom(1.03, 1)).toBe(1.1)
    expect(nextZoom(1.03, -1)).toBe(1)
  })
})
