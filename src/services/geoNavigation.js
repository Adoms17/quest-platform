const EARTH_RADIUS_METERS = 6371000

const toRadians = value => value * Math.PI / 180
const toDegrees = value => value * 180 / Math.PI

export function calculateDistanceMeters(
  [firstLat, firstLng],
  [secondLat, secondLng]
) {
  const latitudeDelta = toRadians(secondLat - firstLat)
  const longitudeDelta = toRadians(secondLng - firstLng)
  const firstLatitude = toRadians(firstLat)
  const secondLatitude = toRadians(secondLat)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
    Math.sin(longitudeDelta / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

export function calculateBearingDegrees(
  [firstLat, firstLng],
  [secondLat, secondLng]
) {
  const firstLatitude = toRadians(firstLat)
  const secondLatitude = toRadians(secondLat)
  const longitudeDelta = toRadians(secondLng - firstLng)
  const y = Math.sin(longitudeDelta) * Math.cos(secondLatitude)
  const x = Math.cos(firstLatitude) * Math.sin(secondLatitude) -
    Math.sin(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitudeDelta)

  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

export function formatCompassDirection(bearing) {
  const directions = [
    'север',
    'северо-восток',
    'восток',
    'юго-восток',
    'юг',
    'юго-запад',
    'запад',
    'северо-запад',
  ]
  return directions[Math.round(bearing / 45) % directions.length]
}

export function createExternalMapUrl({ latitude, longitude, label, userAgent = '' }) {
  const coordinates = `${latitude},${longitude}`
  const encodedLabel = encodeURIComponent(label || 'Место задания')

  if (/android/i.test(userAgent)) {
    return `geo:${coordinates}?q=${coordinates}(${encodedLabel})`
  }
  if (/iphone|ipad|ipod|macintosh.*mobile/i.test(userAgent)) {
    return `https://maps.apple.com/?ll=${coordinates}&q=${encodedLabel}`
  }
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`
}
