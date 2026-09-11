import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const markerStyles = {
  completed: { color: '#15803d', fillColor: '#22c55e', tone: 'completed' },
  locked: { color: '#4b5563', fillColor: '#9ca3af', tone: 'locked' },
  failed: { color: '#b91c1c', fillColor: '#ef4444', tone: 'failed' },
  pending: { color: '#a16207', fillColor: '#eab308', tone: 'pending' },
  available: { color: '#1d4ed8', fillColor: '#3b82f6', tone: 'available' },
  in_progress: { color: '#1d4ed8', fillColor: '#3b82f6', tone: 'available' },
}

function MapBounds({ positionsKey }) {
  const map = useMap()

  useEffect(() => {
    const positions = JSON.parse(positionsKey)
    if (positions.length === 1) {
      map.setView(positions[0], 16)
    } else {
      map.fitBounds(positions, { padding: [32, 32] })
    }
  }, [map, positionsKey])

  return null
}

function getMappedTasks(tasks) {
  return tasks.filter(task => {
    if (task.latitude === null || task.latitude === undefined || task.latitude === '' ||
        task.longitude === null || task.longitude === undefined || task.longitude === '') {
      return false
    }
    const lat = Number(task.latitude)
    const lng = Number(task.longitude)
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  }).map(task => ({
    ...task,
    latitude: Number(task.latitude),
    longitude: Number(task.longitude),
  }))
}

export default function QuestOverviewMap({ tasks, isOnline, onSelectTask }) {
  const mappedTasks = getMappedTasks(tasks)

  if (mappedTasks.length === 0) return null

  if (!isOnline) {
    return (
      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <h2 className="font-semibold text-blue-900">🗺️ Карта заданий</h2>
        <p className="mt-1 text-sm text-gray-600">
          Места заданий сохранены. Картографическая подложка появится после подключения к интернету.
        </p>
      </section>
    )
  }

  const positions = mappedTasks.map(task => [task.latitude, task.longitude])
  const positionsKey = JSON.stringify(positions)

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50">
      <div className="p-4">
        <h2 className="font-semibold text-blue-900">🗺️ Карта заданий</h2>
        <p className="mt-1 text-sm text-gray-600">
          Номера мест совпадают с номерами в списке заданий.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-700" aria-label="Статусы мест на карте">
          <span><span className="text-blue-600">●</span> Доступно</span>
          <span><span className="text-green-600">●</span> Завершено</span>
          <span><span className="text-gray-500">●</span> Недоступно</span>
          <span><span className="text-red-600">●</span> Не выполнено</span>
          <span><span className="text-yellow-600">●</span> Ожидает синхронизации</span>
        </div>
      </div>
      <div
        className="h-72 w-full"
        role="img"
        aria-label="Карта мест заданий. Доступные задания можно выбрать также из списка ниже."
      >
        <MapContainer
          center={positions[0]}
          zoom={14}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <MapBounds positionsKey={positionsKey} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mappedTasks.map(task => {
            const markerStyle = markerStyles[task.status] || markerStyles.available
            return (
              <CircleMarker
                key={task.id}
                center={[task.latitude, task.longitude]}
                radius={11}
                pathOptions={{
                  color: markerStyle.color,
                  fillColor: markerStyle.fillColor,
                  fillOpacity: task.status === 'locked' ? 0.7 : 0.9,
                }}
                eventHandlers={task.selectable
                  ? { click: () => onSelectTask(task.index) }
                  : undefined}
              >
                <Tooltip
                  permanent
                  direction="center"
                  opacity={1}
                  className={`task-number-label task-number-label--${markerStyle.tone}`}
                >
                  #{task.index + 1}
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
    </section>
  )
}
