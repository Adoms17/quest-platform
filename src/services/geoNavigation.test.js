import { describe, expect, it } from 'vitest'
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  createExternalMapUrl,
  formatCompassDirection,
} from './geoNavigation'

describe('geo navigation', () => {
  it('calculates distance and direction to a point', () => {
    const from = [44.6, 33.5]
    const north = [44.601, 33.5]
    expect(calculateDistanceMeters(from, north)).toBeCloseTo(111, 0)
    expect(calculateBearingDegrees(from, north)).toBeCloseTo(0, 1)
    expect(formatCompassDirection(46)).toBe('северо-восток')
  })

  it('creates platform-specific external map links', () => {
    const point = { latitude: 44.6, longitude: 33.5, label: 'Задание №2' }
    expect(createExternalMapUrl({ ...point, userAgent: 'Android' }))
      .toContain('geo:44.6,33.5')
    expect(createExternalMapUrl({ ...point, userAgent: 'iPhone' }))
      .toContain('maps.apple.com')
    expect(createExternalMapUrl({ ...point, userAgent: 'Desktop' }))
      .toContain('openstreetmap.org')
  })
})
