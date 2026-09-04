import { useCallback, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Исправляем иконки маркеров для сборки
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

// Компонент для управления видом карты (центрирование)
function MapController({ center, zoom }) {
  const map = useMap()
  const prevCenter = useRef(null)

  useEffect(() => {
    // Проверяем, что координаты изменились
    if (center && center[0] !== prevCenter.current?.[0] && center[1] !== prevCenter.current?.[1]) {
      map.setView(center, zoom || 15, { animate: true })
      prevCenter.current = center
    }
  }, [center, zoom, map])

  return null
}

// Компонент для обработки кликов и отображения маркера
function LocationMarker({ position, onSelect }) {
  const map = useMap()
  
  const handleClick = useCallback((e) => {
    const lat = e.latlng.lat
    const lng = e.latlng.lng
    if (onSelect) onSelect(lat, lng)
  }, [onSelect])

  // Добавляем обработчик клика через событие
  useEffect(() => {
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [map, handleClick])

  return position ? <Marker position={position} /> : null
}

export default function MapPicker({ onSelect, initialLat, initialLng }) {
  const position = Number.isFinite(initialLat) && Number.isFinite(initialLng)
    ? [initialLat, initialLng]
    : null

  const defaultCenter = [55.7558, 37.6173] // Москва
  const center = position || defaultCenter
  const zoom = position ? 15 : 12

  return (
    <div className="h-64 w-full rounded-sm border">
      <MapContainer
        center={defaultCenter} // начальный центр, будет переопределён контроллером
        zoom={12}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController center={center} zoom={zoom} />
        <LocationMarker
          position={position}
          onSelect={onSelect}
        />
      </MapContainer>
      {position && (
        <div className="text-xs text-gray-500 mt-1">
          Выбрано: {position[0].toFixed(6)}, {position[1].toFixed(6)}
        </div>
      )}
    </div>
  )
}
