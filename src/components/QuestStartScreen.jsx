import QuestConnectionStatus from './QuestConnectionStatus'
import PendingActionStatus from './PendingActionStatus'

const verificationLabels = {
  gps: 'GPS',
  code: 'код на месте',
  answer: 'ответы',
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'не ограничено'
}

function formatPackageSize(value) {
  if (!Number.isFinite(value) || value <= 0) return 'не определён'
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`
}

export default function QuestStartScreen({
  quest,
  taskCount,
  isOnline,
  offlinePackageStatus,
  offlinePackageMetadata,
  hasExistingAttempt,
  startDisabled = false,
  startMessage = '',
  onStart,
}) {
  const verification = (quest.verification_options || [])
    .map(option => verificationLabels[option] || option)
    .join(', ')

  const offlineStatus = offlinePackageStatus === 'ready'
    ? 'Готов к работе без сети'
    : offlinePackageStatus === 'unavailable'
      ? 'Не удалось обновить локальную копию'
      : 'Подготавливается…'

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        {quest.cover_image_url && (
          <img
            src={quest.cover_image_url}
            alt={`Обложка квеста «${quest.title}»`}
            className="aspect-video w-full object-cover"
          />
        )}
        <div className="bg-linear-to-br from-blue-700 to-indigo-500 p-6 text-white sm:p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-100">
            Квест готов к прохождению
          </p>
          <h1 className="mt-2 text-3xl font-bold">{quest.title}</h1>
          {quest.description && (
            <p className="mt-3 max-w-2xl text-blue-50">{quest.description}</p>
          )}
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-gray-50 p-4">
              <dt className="text-sm text-gray-500">Заданий</dt>
              <dd className="mt-1 text-lg font-semibold">{taskCount}</dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <dt className="text-sm text-gray-500">Проверка</dt>
              <dd className="mt-1 text-lg font-semibold">{verification || 'не указана'}</dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <dt className="text-sm text-gray-500">Подключение</dt>
              <dd className="mt-2">
                <QuestConnectionStatus
                  isOnline={isOnline}
                  verificationMode={quest.verification_mode}
                  offlineProgressPolicy={quest.offline_progress_policy}
                />
              </dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <dt className="text-sm text-gray-500">Офлайн-пакет</dt>
              <dd className="mt-1 text-lg font-semibold">{offlineStatus}</dd>
              {offlinePackageMetadata && (
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <p>Версия: {offlinePackageMetadata.packageVersion || 'устаревший формат'}</p>
                  <p>Размер: {formatPackageSize(offlinePackageMetadata.packageSizeBytes)}</p>
                  <p>Проверен: {formatDate(offlinePackageMetadata.validatedAt)}</p>
                  {offlinePackageMetadata.expiresAt && (
                    <p>Действует до: {formatDate(offlinePackageMetadata.expiresAt)}</p>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl bg-gray-50 p-4 sm:col-span-2">
              <dt className="text-sm text-gray-500">Прохождений на участника</dt>
              <dd className="mt-1 text-lg font-semibold">
                {quest.max_quest_attempts > 0
                  ? `Не более ${quest.max_quest_attempts}`
                  : 'Без ограничений'}
              </dd>
            </div>
          </dl>

          {(quest.start_at || quest.end_at) && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
              <p><span className="text-gray-600">Начало:</span> {formatDate(quest.start_at)}</p>
              <p className="mt-1"><span className="text-gray-600">Завершение:</span> {formatDate(quest.end_at)}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onStart}
            disabled={startDisabled}
            className="w-full rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
          >
            {hasExistingAttempt ? 'Продолжить квест' : 'Начать квест'}
          </button>
          <PendingActionStatus
            active={offlinePackageStatus === 'loading'}
            text="Проверяем и обновляем офлайн-пакет…"
            delayedText="Подготовка офлайн-пакета занимает больше времени, чем обычно…"
          />
          {startMessage && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-center text-amber-900">
              {startMessage}
            </p>
          )}
          <p className="text-center text-sm text-gray-500">
            Таймер прохождения запустится после нажатия кнопки.
          </p>
        </div>
      </section>
    </main>
  )
}
