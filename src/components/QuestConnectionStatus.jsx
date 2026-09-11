const offlineModeLabels = {
  hybrid: 'Офлайн · локальная предпроверка',
  secure_online: 'Офлайн · ожидание синхронизации',
  online: 'Офлайн · прохождение приостановлено',
}

export default function QuestConnectionStatus({
  isOnline,
  verificationMode,
  offlineProgressPolicy = 'allow_pending',
  compact = false,
}) {
  const isBlocked = !isOnline && (
    verificationMode === 'online' || offlineProgressPolicy === 'block'
  )
  const modeLabel = isOnline
    ? 'Онлайн'
    : isBlocked
      ? 'Офлайн · прохождение приостановлено'
      : offlineModeLabels[verificationMode] || 'Офлайн'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
        isOnline
          ? 'border-green-200 bg-green-50 text-green-800'
          : isBlocked
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-amber-200 bg-amber-50 text-amber-900'
      } ${compact ? 'w-fit' : 'w-full'}`}
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          isOnline ? 'bg-green-600' : isBlocked ? 'bg-red-600' : 'bg-amber-600'
        }`}
      />
      <span>{isOnline ? 'Сеть доступна' : 'Нет сети'}</span>
      <span aria-hidden="true">·</span>
      <span>Режим: {modeLabel}</span>
    </div>
  )
}
