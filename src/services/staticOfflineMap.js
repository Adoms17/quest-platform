const DEFAULT_MAP_RADIUS_METERS = 150

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
  bounds: customBounds = null,
} = {}) {
  const lat = normalizeCoordinate(task?.location_latitude, -90, 90)
  const lng = normalizeCoordinate(task?.location_longitude, -180, 180)
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key || lat === null || lng === null) return null

  const bounds = fitMapBounds(customBounds || getStaticOfflineMapBounds(lat, lng, mapRadiusMeters))
  const params = new URLSearchParams({
    style: 'osm-bright',
    width: '800',
    height: '600',
    scaleFactor: '1',
    format: 'jpeg',
    area: `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    lang: 'ru',
    attribution: 'default',
    apiKey: key,
  })

  return {
    url: `https://maps.geoapify.com/v1/staticmap?${params}`,
    bounds,
  }
}

const mercator = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI
const inverseMercator = y => (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI

export function fitMapBounds(bounds) {
  const centerX = (bounds.west + bounds.east) / 2
  const centerY = (mercator(bounds.north) + mercator(bounds.south)) / 2
  const height = Math.max(mercator(bounds.north) - mercator(bounds.south), (bounds.east - bounds.west) * 3 / 4)
  return { west: centerX - height * 2 / 3, east: centerX + height * 2 / 3, north: inverseMercator(centerY + height / 2), south: inverseMercator(centerY - height / 2) }
}

export function projectMapPoint(latitude, longitude, bounds) {
  return { x: (longitude - bounds.west) / (bounds.east - bounds.west) * 800, y: (mercator(bounds.north) - mercator(latitude)) / (mercator(bounds.north) - mercator(bounds.south)) * 600 }
}

export function createOverviewMapAsset(tasks, options) {
  const points = tasks.filter(task => task.location_latitude != null && task.location_longitude != null && Number.isFinite(Number(task.location_latitude)) && Number.isFinite(Number(task.location_longitude)))
  if (!points.length) return null
  const boxes = points.map(task => getStaticOfflineMapBounds(task.location_latitude, task.location_longitude, 100)).filter(Boolean)
  if (!boxes.length) return null
  const bounds = { west: Math.min(...boxes.map(b => b.west)), east: Math.max(...boxes.map(b => b.east)), south: Math.min(...boxes.map(b => b.south)), north: Math.max(...boxes.map(b => b.north)) }
  return createGeoapifyStaticMapAsset(points[0], 1, { ...options, bounds })
}
