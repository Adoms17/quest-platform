const verificationLabels = {
  gps: 'GPS',
  code: 'код на месте',
  answer: 'ответы',
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'не ограничено'
}

export default function QuestStartScreen({
  quest,
  taskCount,
  isOnline,
  offlinePackageStatus,
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
              <dd className="mt-1 text-lg font-semibold">
                {isOnline ? 'Онлайн' : 'Нет сети'}
              </dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <dt className="text-sm text-gray-500">Офлайн-пакет</dt>
              <dd className="mt-1 text-lg font-semibold">{offlineStatus}</dd>
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
            className="w-full rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {hasExistingAttempt ? 'Продолжить квест' : 'Начать квест'}
          </button>
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
