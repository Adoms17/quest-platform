import { projectMapPoint } from '../services/staticOfflineMap'

export default function StaticMapOverlay({ imageUrl, bounds, points, participant, radius = 0, onSelect }) {
  if (!bounds) return null
  const here = participant ? projectMapPoint(participant[0], participant[1], bounds) : null
  return <div className="relative overflow-hidden rounded-lg border bg-slate-100" style={{ aspectRatio: '4 / 3' }}>
    {imageUrl && <img src={imageUrl} alt={points.length === 1 ? `Сохранённая офлайн-карта места задания ${points[0].number}` : 'Сохранённая офлайн-карта'} className="absolute inset-0 h-full w-full" />}
    <svg viewBox="0 0 800 600" className="absolute inset-0 h-full w-full" aria-label="Места заданий на офлайн-карте">
      {points.map(point => {
        const p = projectMapPoint(point.latitude, point.longitude, bounds)
        const radiusPixels = radius / (111320 * Math.cos(point.latitude * Math.PI / 180) * (bounds.east - bounds.west)) * 800
        return <g key={point.id}>
          {radius > 0 && <circle cx={p.x} cy={p.y} r={radiusPixels} fill="#60a5fa" fillOpacity="0.18" stroke="#2563eb" strokeWidth="3" />}
          {here && points.length === 1 && <line x1={here.x} y1={here.y} x2={p.x} y2={p.y} stroke="#475569" strokeWidth="3" strokeDasharray="8 6" />}
          <g role={point.selectable ? 'button' : 'img'} tabIndex={point.selectable ? 0 : undefined} aria-label={`Место задания №${point.number}`} onClick={() => point.selectable && onSelect?.(point.index)} onKeyDown={e => { if (point.selectable && ['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect?.(point.index) } }}>
            <circle cx={p.x} cy={p.y} r="20" fill={point.color || '#2563eb'} stroke="white" strokeWidth="3" />
            <text x={p.x} y={p.y} dy=".35em" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">{point.number}</text>
          </g>
        </g>
      })}
      {here && <circle cx={here.x} cy={here.y} r="10" fill="#22c55e" stroke="#166534" strokeWidth="3" aria-label="Ваша текущая позиция на сохранённой карте" />}
    </svg>
  </div>
}
