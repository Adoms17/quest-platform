import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getGeolocationErrorMessage } from '../services/verificationPolicy'
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  createExternalMapUrl,
  formatCompassDirection,
} from '../services/geoNavigation'
import OfflineLocationGuide from './OfflineLocationGuide'
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

export default function TaskLocationMap({
  latitude,
  longitude,
  isOnline,
  taskNumber,
  verificationRadiusMeters = null,
  offlineMapImageUrl = null,
  offlineMapBounds = null,
}) {
  const [participantPosition, setParticipantPosition] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [trackingLocation, setTrackingLocation] = useState(false)
  const [locationActionMessage, setLocationActionMessage] = useState('')
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
  const bearingDegrees = participantPosition
    ? calculateBearingDegrees(
      participantPosition.coordinates,
      [lat, lng]
    )
    : null
  const hasVerificationRadius = Number.isFinite(verificationRadiusMeters) &&
    verificationRadiusMeters > 0
  const isInsideVerificationZone = distanceMeters !== null &&
    hasVerificationRadius &&
    distanceMeters <= verificationRadiusMeters
  const taskLabel = `Место задания${taskNumber ? ` №${taskNumber}` : ''}`
  const coordinatesText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  const externalMapUrl = createExternalMapUrl({
    latitude: lat,
    longitude: lng,
    label: taskLabel,
    userAgent: navigator.userAgent,
  })

  async function copyCoordinates() {
    try {
      await navigator.clipboard.writeText(coordinatesText)
      setLocationActionMessage('Координаты скопированы')
    } catch {
      setLocationActionMessage('Не удалось скопировать координаты')
    }
  }

  async function shareLocation() {
    try {
      await navigator.share({
        title: taskLabel,
        text: `${taskLabel}: ${coordinatesText}`,
      })
      setLocationActionMessage('Точка передана')
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setLocationActionMessage('Не удалось передать точку')
      }
    }
  }

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
        <div className="mt-2 space-y-1 rounded-lg bg-white p-3 text-sm text-gray-700" aria-live="polite">
          <p><strong>Место задания:</strong> {lat.toFixed(6)}, {lng.toFixed(6)}</p>
          {participantPosition && (
            <>
            <p><strong>Вы здесь:</strong> {participantPosition.coordinates[0].toFixed(6)}, {participantPosition.coordinates[1].toFixed(6)}</p>
            <p><strong>Расстояние до места:</strong> примерно {distanceMeters} м</p>
            {participantPosition.accuracy !== null && (
              <p><strong>Точность геопозиции:</strong> около {participantPosition.accuracy} м</p>
            )}
            </>
          )}
          {hasVerificationRadius && (
            <p><strong>Радиус GPS-проверки:</strong> {verificationRadiusMeters} м</p>
          )}
          {participantPosition && (
            <>
            <p>
              <strong>Направление:</strong>{' '}
              {formatCompassDirection(bearingDegrees)} · {Math.round(bearingDegrees)}°
            </p>
            {hasVerificationRadius && (
              <p className={isInsideVerificationZone ? 'font-medium text-green-700' : ''}>
                {isInsideVerificationZone
                  ? 'Вы находитесь внутри радиуса проверки.'
                  : `До зоны проверки примерно ${Math.max(0, distanceMeters - verificationRadiusMeters)} м.`}
              </p>
            )}
            </>
          )}
        </div>
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
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={externalMapUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Открыть в картах
          </a>
          <button type="button" onClick={copyCoordinates} className="rounded-sm border border-blue-600 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">
            Скопировать координаты
          </button>
          {typeof navigator.share === 'function' && (
            <button type="button" onClick={shareLocation} className="rounded-sm border border-blue-600 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">
              Поделиться точкой
            </button>
          )}
        </div>
        {locationActionMessage && (
          <p className="mt-2 text-sm text-gray-700" aria-live="polite">{locationActionMessage}</p>
        )}
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
        <OfflineLocationGuide
          taskPosition={[lat, lng]}
          participantPosition={participantPosition}
          taskNumber={taskNumber}
          verificationRadiusMeters={verificationRadiusMeters}
          imageUrl={offlineMapImageUrl}
          imageBounds={offlineMapBounds}
        />
      )}
    </section>
  )
}
