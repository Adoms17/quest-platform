const DEFAULT_MAP_RADIUS_METERS = 500
const DEFAULT_VERIFICATION_RADIUS_METERS = 50

function normalizeCoordinate(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function getStaticOfflineMapBounds(latitude, longitude, radiusMeters = DEFAULT_MAP_RADIUS_METERS) {
  const lat = normalizeCoordinate(latitude, -90, 90)
  const lng = normalizeCoordinate(longitude, -180, 180)
  const radius = Math.max(1, Number(radiusMeters) || DEFAULT_MAP_RADIUS_METERS)
  if (lat === null || lng === null) return null

  const latitudeDelta = radius / 111_320
  const longitudeScale = Math.max(0.01, Math.cos(lat * Math.PI / 180))
  const longitudeDelta = radius / (111_320 * longitudeScale)
  return {
    south: lat - latitudeDelta,
    west: lng - longitudeDelta,
    north: lat + latitudeDelta,
    east: lng + longitudeDelta,
  }
}

export function createGeoapifyStaticMapAsset(task, taskNumber, {
  apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY,
  mapRadiusMeters = DEFAULT_MAP_RADIUS_METERS,
  verificationRadiusMeters = DEFAULT_VERIFICATION_RADIUS_METERS,
} = {}) {
  const lat = normalizeCoordinate(task?.location_latitude, -90, 90)
  const lng = normalizeCoordinate(task?.location_longitude, -180, 180)
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key || lat === null || lng === null) return null

  const bounds = getStaticOfflineMapBounds(lat, lng, mapRadiusMeters)
  const params = new URLSearchParams({
    style: 'osm-bright',
    width: '800',
    height: '600',
    scaleFactor: '1',
    format: 'jpeg',
    area: `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    marker: `lonlat:${lng},${lat};type:circle;color:#2563eb;size:48;text:${taskNumber};contentcolor:#ffffff;shadow:no`,
    geometry: `circle:${lng},${lat},${verificationRadiusMeters};linewidth:3;linecolor:#2563eb;fillcolor:#60a5fa;fillopacity:0.18`,
    attribution: 'default',
    apiKey: key,
  })

  return {
    url: `https://maps.geoapify.com/v1/staticmap?${params}`,
    bounds,
  }
}
