import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getGeolocationErrorMessage } from '../services/verificationPolicy'
import 'leaflet/dist/leaflet.css'

function MapViewport({ taskLatitude, taskLongitude, participantPosition }) {
  const map = useMap()

  useEffect(() => {
    const taskPosition = [taskLatitude, taskLongitude]
    if (participantPosition) {
      map.fitBounds([taskPosition, participantPosition.coordinates], { padding: [32, 32] })
    } else {
      map.setView(taskPosition, 16)
    }
  }, [map, participantPosition, taskLatitude, taskLongitude])

  return null
}

function calculateDistanceMeters([firstLat, firstLng], [secondLat, secondLng]) {
  const earthRadiusMeters = 6371000
  const toRadians = value => value * Math.PI / 180
  const latitudeDelta = toRadians(secondLat - firstLat)
  const longitudeDelta = toRadians(secondLng - firstLng)
  const firstLatitude = toRadians(firstLat)
  const secondLatitude = toRadians(secondLat)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
    Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
}

export default function TaskLocationMap({
  latitude,
  longitude,
  isOnline,
  taskNumber,
  verificationRadiusMeters = null,
}) {
  const [participantPosition, setParticipantPosition] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [trackingLocation, setTrackingLocation] = useState(false)
  const locationWatchIdRef = useRef(null)

  useEffect(() => () => {
    if (locationWatchIdRef.current !== null) {
      navigator.geolocation?.clearWatch?.(locationWatchIdRef.current)
    }
  }, [])

  if (latitude === null || latitude === undefined || latitude === '' ||
      longitude === null || longitude === undefined || longitude === '') {
    return null
  }

  const lat = Number(latitude)
  const lng = Number(longitude)

  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }

  function requestParticipantLocation() {
    if (!navigator.geolocation) {
      setLocationError('Геолокация не поддерживается этим устройством.')
      return
    }

    setLocationLoading(true)
    setLocationError('')
    const handlePosition = position => {
      setParticipantPosition({
        coordinates: [position.coords.latitude, position.coords.longitude],
        accuracy: Number.isFinite(position.coords.accuracy)
          ? Math.round(position.coords.accuracy)
          : null,
      })
      setLocationLoading(false)
    }
    const handleError = error => {
      setLocationError(getGeolocationErrorMessage(error))
      setLocationLoading(false)
      setTrackingLocation(false)
    }
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }

    if (navigator.geolocation.watchPosition) {
      locationWatchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        options
      )
      setTrackingLocation(true)
    } else {
      navigator.geolocation.getCurrentPosition(handlePosition, handleError, options)
    }
  }

  const distanceMeters = participantPosition
    ? Math.round(calculateDistanceMeters(
      participantPosition.coordinates,
      [lat, lng]
    ))
    : null

  function stopParticipantLocationTracking() {
    if (locationWatchIdRef.current !== null) {
      navigator.geolocation?.clearWatch?.(locationWatchIdRef.current)
      locationWatchIdRef.current = null
    }
    setTrackingLocation(false)
    setLocationLoading(false)
  }

  return (
    <section className="mb-4 overflow-hidden rounded-sm border border-blue-200 bg-blue-50">
      <div className="p-3">
        <h4 className="font-semibold text-blue-700">🗺️ Ориентир на карте</h4>
        <p className="mt-1 text-xs text-gray-600">
          Место задания: {lat.toFixed(6)}, {lng.toFixed(6)}
        </p>
        {participantPosition && (
          <div className="mt-1 space-y-1 text-xs text-green-700" aria-live="polite">
            <p>Вы здесь: {participantPosition.coordinates[0].toFixed(6)}, {participantPosition.coordinates[1].toFixed(6)}</p>
            <p>Расстояние до места: примерно {distanceMeters} м</p>
            {participantPosition.accuracy !== null && (
              <p>Точность геопозиции: около {participantPosition.accuracy} м</p>
            )}
          </div>
        )}
        {Number.isFinite(verificationRadiusMeters) && verificationRadiusMeters > 0 && (
          <p className="mt-1 text-xs text-blue-700">
            Радиус GPS-проверки: {verificationRadiusMeters} м
          </p>
        )}
        <button
          type="button"
          onClick={trackingLocation
            ? stopParticipantLocationTracking
            : requestParticipantLocation}
          disabled={locationLoading}
          className="mt-3 rounded-sm border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
        >
          {trackingLocation
            ? 'Остановить обновление геопозиции'
            : locationLoading
            ? 'Определяем геопозицию…'
            : participantPosition
              ? 'Возобновить обновление геопозиции'
              : 'Показать мою геопозицию'}
        </button>
        {locationError && (
          <p role="alert" className="mt-2 text-sm text-red-600">{locationError}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-700">
          <span><span className="text-blue-600">●</span> Место задания</span>
          <span><span className="text-green-600">●</span> Вы здесь</span>
        </div>
      </div>

      {isOnline ? (
        <div
          className="h-64 w-full"
          role="img"
          aria-label={`Карта места задания ${taskNumber || ''}`.trim()}
        >
          <MapContainer
            center={[lat, lng]}
            zoom={16}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <MapViewport
              taskLatitude={lat}
              taskLongitude={lng}
              participantPosition={participantPosition}
            />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <CircleMarker
              center={[lat, lng]}
              radius={10}
              pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.85 }}
            >
              {Number.isInteger(taskNumber) && taskNumber > 0 && (
                <Tooltip
                  permanent
                  direction="center"
                  opacity={1}
                  className="task-number-label"
                >
                  #{taskNumber}
                </Tooltip>
              )}
            </CircleMarker>
            {Number.isFinite(verificationRadiusMeters) && verificationRadiusMeters > 0 && (
              <Circle
                center={[lat, lng]}
                radius={verificationRadiusMeters}
                pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 0.12 }}
              />
            )}
            {participantPosition && (
              <CircleMarker
                center={participantPosition.coordinates}
                radius={9}
                pathOptions={{ color: '#15803d', fillColor: '#22c55e', fillOpacity: 0.9 }}
              />
            )}
          </MapContainer>
        </div>
      ) : (
        <p className="border-t border-blue-200 p-3 text-sm text-gray-600">
          Нет подключения к интернету. Координаты сохранены, картографическая подложка появится после подключения.
        </p>
      )}
    </section>
  )
}
