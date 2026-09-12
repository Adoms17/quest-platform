import {
  calculateBearingDegrees,
  calculateDistanceMeters,
} from '../services/geoNavigation'

export default function OfflineLocationGuide({
  taskPosition,
  participantPosition,
  taskNumber,
  verificationRadiusMeters,
  imageUrl = null,
  imageBounds = null,
}) {
  const distance = participantPosition
    ? calculateDistanceMeters(participantPosition.coordinates, taskPosition)
    : null
  const bearing = participantPosition
    ? calculateBearingDegrees(participantPosition.coordinates, taskPosition)
    : null
  const radius = Number.isFinite(verificationRadiusMeters) && verificationRadiusMeters > 0
    ? verificationRadiusMeters
    : 50
  const scaleMeters = Math.max(radius * 1.5, distance || 0, 100)
  const drawableRadius = 70
  const taskRadius = Math.max(8, radius / scaleMeters * drawableRadius)
  const participantDistance = distance === null
    ? 0
    : Math.min(drawableRadius, distance / scaleMeters * drawableRadius)
  const angle = bearing === null ? 0 : bearing * Math.PI / 180
  const participantX = 160 - Math.sin(angle) * participantDistance
  const participantY = 105 + Math.cos(angle) * participantDistance
  const participantLatitude = participantPosition?.coordinates?.[0]
  const participantLongitude = participantPosition?.coordinates?.[1]
  const participantInsideImage = imageBounds &&
    Number.isFinite(participantLatitude) &&
    Number.isFinite(participantLongitude) &&
    participantLatitude >= imageBounds.south && participantLatitude <= imageBounds.north &&
    participantLongitude >= imageBounds.west && participantLongitude <= imageBounds.east
  const participantImagePosition = participantInsideImage
    ? {
      left: `${(participantLongitude - imageBounds.west) /
        (imageBounds.east - imageBounds.west) * 100}%`,
      top: `${(imageBounds.north - participantLatitude) /
        (imageBounds.north - imageBounds.south) * 100}%`,
    }
    : null
  return (
    <div className="border-t border-blue-200 bg-slate-50 p-3">
      {imageUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
          <img
            src={imageUrl}
            alt={`Сохранённая офлайн-карта места задания ${taskNumber || ''}`.trim()}
            className="h-auto w-full"
          />
          {participantImagePosition && (
            <span
              aria-label="Ваша текущая позиция на сохранённой карте"
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-800 bg-green-500 shadow"
              style={participantImagePosition}
            />
          )}
        </div>
      ) : <div
          role="img"
          aria-label={`Офлайн-схема места задания ${taskNumber || ''}`.trim()}
          className="overflow-hidden rounded-lg border border-slate-300 bg-white"
        >
        <svg viewBox="0 0 320 210" className="h-52 w-full" aria-hidden="true">
          <defs>
            <pattern id="offline-map-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="320" height="210" fill="url(#offline-map-grid)" />
          <text x="160" y="18" textAnchor="middle" fill="#475569" fontSize="12">С</text>
          <path d="M160 24 L154 38 L160 35 L166 38 Z" fill="#475569" />
          <circle cx="160" cy="105" r={taskRadius} fill="#bfdbfe" fillOpacity="0.55" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 4" />
          {participantPosition && (
            <line x1={participantX} y1={participantY} x2="160" y2="105" stroke="#64748b" strokeWidth="2" strokeDasharray="5 4" />
          )}
          <circle cx="160" cy="105" r="16" fill="#2563eb" />
          <text x="160" y="110" textAnchor="middle" fill="white" fontSize="12" fontWeight="700">
            #{taskNumber || '•'}
          </text>
          {participantPosition && (
            <>
              <circle cx={participantX} cy={participantY} r="10" fill="#22c55e" stroke="#15803d" strokeWidth="3" />
              <text x={participantX} y={participantY + 25} textAnchor="middle" fill="#166534" fontSize="11">Вы</text>
            </>
          )}
        </svg>
        </div>}
      <p className="mt-2 text-xs text-gray-600">
        {imageUrl
          ? 'Сохранённая карта доступна без подключения к интернету.'
          : 'Схема работает без картографической подложки и не заменяет карту улиц.'}
      </p>
    </div>
  )
}
