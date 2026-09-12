import { describe, expect, it } from 'vitest'
import {
  assessOfflineMediaBudget,
  collectOfflineMediaManifest,
  downloadOfflineMediaAssets,
  MAX_OFFLINE_MEDIA_BYTES,
} from './offlineMedia'

describe('offline media manifest', () => {
  it('collects and deduplicates only remote participant media', () => {
    expect(collectOfflineMediaManifest({
      cover_image_url: 'https://media.test/cover.jpg',
    }, [{
      id: 'task-1',
      location_image_url: 'https://media.test/cover.jpg',
      media: [{ url: 'https://media.test/video.mp4' }],
    }, {
      id: 'task-2',
      media: [{ url: 'javascript:alert(1)' }],
    }])).toEqual([
      {
        url: 'https://media.test/cover.jpg',
        targets: [
          { kind: 'cover', field: 'cover_image_url', taskId: null },
          { kind: 'location-image', field: 'location_image_url', taskId: 'task-1' },
        ],
      },
      {
        url: 'https://media.test/video.mp4',
        targets: [{ kind: 'task-media', field: 'media', taskId: 'task-1', mediaIndex: 0 }],
      },
    ])
  })

  it('downloads each deduplicated asset and reports its actual size', async () => {
    const result = await downloadOfflineMediaAssets([{
      url: 'https://media.test/cover.jpg',
      targets: [{ kind: 'cover', field: 'cover_image_url', taskId: null }],
    }], {
      fetchImpl: async () => ({
        ok: true,
        blob: async () => new Blob(['image'], { type: 'image/jpeg' }),
      }),
      storageEstimate: { quota: 100_000_000, usage: 0 },
    })

    expect(result.assetBytes).toBe(5)
    expect(result.assets[0]).toMatchObject({ sizeBytes: 5, contentType: 'image/jpeg' })
  })

  it('adds an optional static map with bounds when Geoapify is configured', () => {
    const manifest = collectOfflineMediaManifest({}, [{
      id: 'task-1',
      location_latitude: 44.6,
      location_longitude: 33.5,
    }], { staticMap: { apiKey: 'public-test-key' } })

    expect(manifest).toHaveLength(1)
    expect(manifest[0]).toMatchObject({
      optional: true,
      targets: [{
        kind: 'offline-map',
        field: 'offline_map_image_url',
        taskId: 'task-1',
        bounds: expect.objectContaining({ north: expect.any(Number), west: expect.any(Number) }),
      }],
    })
  })

  it('keeps preparing the package when an optional static map is unavailable', async () => {
    const result = await downloadOfflineMediaAssets([{
      url: 'https://maps.geoapify.com/v1/staticmap',
      optional: true,
      targets: [],
    }], {
      fetchImpl: async () => ({ ok: false }),
      storageEstimate: null,
    })

    expect(result).toEqual({ assets: [], assetBytes: 0 })
  })

  it('rejects a package larger than the application limit', () => {
    expect(assessOfflineMediaBudget({
      assetBytes: MAX_OFFLINE_MEDIA_BYTES + 1,
      storageEstimate: null,
    })).toMatchObject({ allowed: false, reason: 'package_limit' })
  })

  it('keeps a reserve when checking browser storage quota', () => {
    expect(assessOfflineMediaBudget({
      assetBytes: 15,
      storageEstimate: { quota: 100, usage: 80 },
      maxPackageBytes: 100,
      reserveBytes: 10,
    })).toEqual({
      allowed: false,
      reason: 'storage_quota',
      availableBytes: 10,
    })
  })
})
