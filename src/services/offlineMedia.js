export const MAX_OFFLINE_MEDIA_BYTES = 50 * 1024 * 1024
export const MIN_STORAGE_RESERVE_BYTES = 10 * 1024 * 1024

const MEDIA_FIELDS = [
  ['cover', 'cover_image_url'],
  ['task-media', 'media_url'],
  ['location-image', 'location_image_url'],
]

function isRemoteMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function collectOfflineMediaManifest(quest, tasks = []) {
  const assets = []
  const byUrl = new Map()

  const addAsset = (kind, field, url, taskId = null) => {
    if (!isRemoteMediaUrl(url)) return
    const target = { kind, field, taskId }
    const existing = byUrl.get(url)
    if (existing) {
      existing.targets.push(target)
      return
    }
    const asset = { url, targets: [target] }
    byUrl.set(url, asset)
    assets.push(asset)
  }

  addAsset('cover', 'cover_image_url', quest?.cover_image_url)
  for (const task of tasks) {
    for (const [kind, field] of MEDIA_FIELDS.slice(1)) {
      addAsset(kind, field, task?.[field], task?.id || null)
    }
  }

  return assets
}

export async function downloadOfflineMediaAssets(
  manifest,
  { fetchImpl = fetch, storageEstimate = null } = {},
) {
  const downloaded = []
  let assetBytes = 0

  for (const item of manifest) {
    const response = await fetchImpl(item.url)
    if (!response.ok) {
      const error = new Error('Не удалось скачать медиаресурсы квеста для офлайн-режима')
      error.code = 'OFFLINE_MEDIA_DOWNLOAD_FAILED'
      throw error
    }
    const blob = await response.blob()
    assetBytes += blob.size
    const budget = assessOfflineMediaBudget({ assetBytes, storageEstimate })
    if (!budget.allowed) {
      const error = new Error(budget.reason === 'storage_quota'
        ? 'Недостаточно свободного места для офлайн-пакета квеста'
        : 'Размер медиаресурсов офлайн-пакета превышает 50 МБ')
      error.code = budget.reason === 'storage_quota'
        ? 'OFFLINE_STORAGE_QUOTA'
        : 'OFFLINE_PACKAGE_TOO_LARGE'
      throw error
    }
    downloaded.push({ blob, sizeBytes: blob.size, contentType: blob.type, targets: item.targets })
  }

  return { assets: downloaded, assetBytes }
}

export function assessOfflineMediaBudget({
  assetBytes,
  storageEstimate,
  maxPackageBytes = MAX_OFFLINE_MEDIA_BYTES,
  reserveBytes = MIN_STORAGE_RESERVE_BYTES,
}) {
  const normalizedBytes = Math.max(0, Number(assetBytes) || 0)
  const quota = Number(storageEstimate?.quota)
  const usage = Number(storageEstimate?.usage)
  const availableBytes = Number.isFinite(quota) && Number.isFinite(usage)
    ? Math.max(0, quota - usage - reserveBytes)
    : null

  if (normalizedBytes > maxPackageBytes) {
    return { allowed: false, reason: 'package_limit', availableBytes }
  }
  if (availableBytes !== null && normalizedBytes > availableBytes) {
    return { allowed: false, reason: 'storage_quota', availableBytes }
  }
  return { allowed: true, reason: null, availableBytes }
}

export async function estimateOfflineStorage() {
  if (!globalThis.navigator?.storage?.estimate) return null
  try {
    return await globalThis.navigator.storage.estimate()
  } catch {
    return null
  }
}
