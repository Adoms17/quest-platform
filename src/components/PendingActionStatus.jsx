import { useEffect, useState } from 'react'

function ActivePendingActionStatus({
  text = 'Операция выполняется…',
  delayedText = 'Ответ занимает больше времени, чем обычно. Продолжаем ожидание…',
  delayMs = 8000,
  className = '',
}) {
  const [isDelayed, setIsDelayed] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => setIsDelayed(true), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
      />
      <span>{isDelayed ? delayedText : text}</span>
    </div>
  )
}

export default function PendingActionStatus({ active, ...props }) {
  if (!active) return null
  return <ActivePendingActionStatus {...props} />
}
