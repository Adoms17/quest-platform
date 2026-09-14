import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ParticipantProfileSearch from '../components/ParticipantProfileSearch'
import Loader from '../components/Loader'
import { useParticipantHistory } from '../hooks/useParticipantHistory'

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'ещё не завершено'
}

export default function ParticipantHistory({ session }) {
  const [params] = useSearchParams()
  const requestedProfile = params.get('participant') || ''
  return <History key={`${session?.user?.id}:${requestedProfile}`} requestedProfile={requestedProfile} actorId={session?.user?.id} />
}

function History({ requestedProfile, actorId }) {
  const [participantProfileId, setParticipantProfileId] = useState(requestedProfile)

  return (
    <div className="mx-auto max-w-4xl space-y-6 break-words p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">История прохождений</h1>
        <p className="mt-2 text-gray-600">Результаты вашего профиля и участников, которыми вы управляете.</p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <ParticipantProfileSearch
          actorId={actorId}
          value={participantProfileId}
          onChange={setParticipantProfileId}
        />
      </div>

      <HistoryResults key={participantProfileId} participantProfileId={participantProfileId} />
    </div>
  )
}

function HistoryResults({ participantProfileId }) {
  const { items: history, loading, error, denied, has_more: hasMore, moreLoading, loadMore, retry } = useParticipantHistory(participantProfileId)
  if (!participantProfileId) return null
  return <>
      {loading && <Loader text="Загрузка истории..." />}
      {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
        <p>{denied ? 'Доступ к истории участника больше недоступен.' : 'Не удалось загрузить историю выбранного участника.'}</p>
        {!hasMore && <button type="button" className="mt-2 underline" onClick={retry}>Повторить загрузку</button>}
      </div>}
      {!loading && !error && history.length === 0 && (
        <p className="rounded-lg border bg-white p-5 text-gray-600">У этого участника пока нет прохождений.</p>
      )}

      {!loading && history.map(attempt => {
        const total = attempt.total_tasks || 0
        const processed = (attempt.completed_tasks || 0) + (attempt.failed_tasks || 0)
        const percent = total > 0
          ? Math.round(((attempt.completed_tasks || 0) / total) * 100)
          : 0
        return (
          <article key={attempt.quest_attempt_id} className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{attempt.quest_title}</h2>
                <p className="mt-1 text-sm text-gray-500">Начато: {formatDate(attempt.started_at)}</p>
                <p className="text-sm text-gray-500">Завершено: {formatDate(attempt.finished_at)}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm ${attempt.finished_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {attempt.finished_at ? 'Завершён' : 'В процессе'}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><span className="block text-gray-500">Обработано</span>{processed} из {total}</div>
              <div><span className="block text-gray-500">Успешно</span>{attempt.completed_tasks || 0}</div>
              <div><span className="block text-gray-500">Неуспешно</span>{attempt.failed_tasks || 0}</div>
              <div><span className="block text-gray-500">Результат</span>{percent}%</div>
            </div>
            {!attempt.finished_at && (
              <Link to={`/play/${attempt.quest_id}?participant=${encodeURIComponent(participantProfileId)}`} className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white">
                Продолжить прохождение
              </Link>
            )}
          </article>
        )
      })}
      {hasMore && <button type="button" disabled={moreLoading} onClick={loadMore} className="w-full rounded-xl border bg-white px-4 py-3 font-medium text-blue-700 disabled:opacity-50">
        {moreLoading ? 'Загрузка…' : error ? 'Повторить загрузку следующей порции' : 'Показать ещё прохождения'}
      </button>}
  </>
}
