import { describe, expect, it } from 'vitest'
import layout from '../../assets/warehouse/open-layout.json'
import conversion from '../../assets/warehouse/conversion.json'
import { safeArtifactUrl } from './officeState'

describe('open-office contract', () => {
  it('keeps all zones inside the floor with four-meter circulation gaps', () => {
    for (const zone of layout.departments) {
      expect(Math.abs(zone.position[0]) + zone.size[0] / 2).toBeLessThan(
        layout.width / 2,
      )
      expect(Math.abs(zone.position[2]) + zone.size[1] / 2).toBeLessThan(
        layout.depth / 2,
      )
    }
    for (let i = 0; i < layout.departments.length; i++)
      for (const other of layout.departments.slice(i + 1)) {
        const zone = layout.departments[i]
        const gapX =
          Math.abs(zone.position[0] - other.position[0]) -
          (zone.size[0] + other.size[0]) / 2
        const gapZ =
          Math.abs(zone.position[2] - other.position[2]) -
          (zone.size[1] + other.size[1]) / 2
        expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(4)
      }
    expect(conversion.bounds[1][1]).toBe(0)
    expect(conversion.components.map((component) => component.name)).toEqual([
      'OPEN_OFFICE_FLOOR',
    ])
  })
  it.each([
    'javascript:alert(1)',
    'data:text/html,anything',
    'https://user:secret@example.com/a',
    'not a URL',
  ])('rejects unsafe or invalid artifact link %s', (value) => {
    expect(safeArtifactUrl(value)).toBeUndefined()
  })
})
