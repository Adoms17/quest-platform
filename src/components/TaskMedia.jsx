import { getTaskMediaKind } from '../services/taskMedia'

function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, window.location.origin)
    return ['http:', 'https:', 'blob:'].includes(url.protocol) ? value : null
  } catch {
    return null
  }
}

export default function TaskMedia({ media = [], isOnline = true }) {
  const items = Array.isArray(media) ? media : []
  const safeItems = items
    .map(item => ({ ...item, url: safeMediaUrl(item?.url) }))
    .filter(item => item.url)
  if (safeItems.length === 0) return null

  return <div className="mb-4 space-y-4">
    {safeItems.map((item, index) => {
      const unavailable = !isOnline && item.offline_unavailable
      const kind = unavailable ? null : getTaskMediaKind(item.url, item.content_type || '')
      return <figure key={`${item.url}:${index}`} className="rounded-lg border bg-gray-50 p-3">
        {item.title && <figcaption className="mb-2 font-medium">{item.title}</figcaption>}
        {unavailable && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3">Материал недоступен офлайн. Подключитесь к интернету и обновите пакет.</p>}
        {kind === 'image' && <img src={item.url} alt={item.title || `Медиафайл ${index + 1}`} className="max-h-[70vh] max-w-full rounded-sm object-contain" />}
        {kind === 'video' && <video controls preload="metadata" className="max-h-[70vh] max-w-full rounded-sm"><source src={item.url} type={item.content_type || undefined} /></video>}
        {kind === 'audio' && <audio controls preload="metadata" className="w-full"><source src={item.url} type={item.content_type || undefined} /></audio>}
        {item.description && <p className="mt-2 text-sm text-gray-600">{item.description}</p>}
      </figure>
    })}
  </div>
}
