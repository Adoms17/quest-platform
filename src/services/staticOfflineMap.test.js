import { describe, expect, it } from 'vitest'
import { createGeoapifyStaticMapAsset, getStaticOfflineMapBounds, fitMapBounds, projectMapPoint } from './staticOfflineMap'

describe('static offline map', () => {
  it('builds a cacheable map request with a numbered marker, radius and attribution', () => {
    const asset = createGeoapifyStaticMapAsset({
      location_latitude: 44.6,
      location_longitude: 33.5,
    }, 2, { apiKey: 'public-test-key', verificationRadiusMeters: 50 })

    const url = new URL(asset.url)
    expect(url.origin).toBe('https://maps.geoapify.com')
    expect(url.searchParams.has('marker')).toBe(false)
    expect(url.searchParams.has('geometry')).toBe(false)
    expect(url.searchParams.get('attribution')).toBe('default')
    expect(url.searchParams.get('apiKey')).toBe('public-test-key')
    expect(asset.bounds).toEqual(fitMapBounds(getStaticOfflineMapBounds(44.6, 33.5, 150)))
    const center = projectMapPoint(44.6, 33.5, asset.bounds)
    expect(center.x).toBeCloseTo(400, 0)
    expect(center.y).toBeCloseTo(300, 0)
  })

  it('does not create a request without a configured key or valid coordinates', () => {
    expect(createGeoapifyStaticMapAsset({
      location_latitude: 44.6,
      location_longitude: 33.5,
    }, 1, { apiKey: '' })).toBeNull()
    expect(createGeoapifyStaticMapAsset({
      location_latitude: 100,
      location_longitude: 33.5,
    }, 1, { apiKey: 'key' })).toBeNull()
  })
})
