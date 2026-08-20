import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { CLOTHING_TYPES } from '@/lib/types'
import { TYPE_ICON_OPTIONS, BUILTIN_TYPE_ICONS, getBuiltinTypeIcon, getTypeIcon } from '@/lib/type-icons'

describe('type-icons', () => {
  const knownNames = new Set(TYPE_ICON_OPTIONS.map((o) => o.name))

  it('every built-in clothing type has its own icon mapping, not the fallback default', () => {
    for (const { value } of CLOTHING_TYPES) {
      expect(BUILTIN_TYPE_ICONS[value], `missing icon mapping for "${value}"`).toBeDefined()
    }
  })

  it('every mapped icon name exists in the curated picker list', () => {
    for (const [value, iconName] of Object.entries(BUILTIN_TYPE_ICONS)) {
      expect(knownNames.has(iconName), `"${value}" maps to unknown icon "${iconName}"`).toBe(true)
    }
  })

  it('falls back to the default icon for an unrecognized type', () => {
    expect(getBuiltinTypeIcon('nonexistent-type')).toBe('Shirt')
  })

  it('getTypeIcon resolves a known name and falls back for an unknown one', () => {
    expect(getTypeIcon('Pants')).toBeDefined()
    expect(getTypeIcon('NotARealIcon')).toBe(getTypeIcon(undefined))
  })

  it('every curated icon renders a non-empty svg', () => {
    for (const { name, Icon } of TYPE_ICON_OPTIONS) {
      const { container } = render(createElement(Icon, { className: 'h-4 w-4' }))
      const svg = container.querySelector('svg')
      expect(svg, `"${name}" did not render an <svg>`).toBeTruthy()
      expect(svg?.classList.contains('h-4'), `"${name}" did not forward className`).toBe(true)
      expect(svg?.children.length, `"${name}" rendered an empty <svg>`).toBeGreaterThan(0)
    }
  })

  it('every hand-drawn icon has a non-empty "d" on each of its paths', () => {
    const handDrawn = ['Pants', 'Shorts', 'Skirt', 'Dress', 'Jacket', 'Cardigan', 'Sock', 'Tie', 'Hat', 'Scarf', 'Belt']
    for (const name of handDrawn) {
      const Icon = TYPE_ICON_OPTIONS.find((o) => o.name === name)?.Icon
      expect(Icon, `"${name}" missing from TYPE_ICON_OPTIONS`).toBeDefined()
      const { container } = render(createElement(Icon!))
      const paths = container.querySelectorAll('path')
      expect(paths.length, `"${name}" rendered no <path>`).toBeGreaterThan(0)
      paths.forEach((p) => {
        expect(p.getAttribute('d'), `"${name}" has a path with no "d"`).toBeTruthy()
      })
    }
  })
})
