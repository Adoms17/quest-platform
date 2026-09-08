import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ParticipantProfileSelect from '../components/ParticipantProfileSelect'
import Loader from '../components/Loader'
import { listParticipantQuestHistory } from '../services/participantHistoryApi'

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'ещё не завершено'
}

export default function ParticipantHistory() {
  const [participantProfileId, setParticipantProfileId] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    if (!participantProfileId) return
    setLoading(true)
    setError('')
    try {
      setHistory(await listParticipantQuestHistory(participantProfileId))
    } catch {
      setHistory([])
      setError('Не удалось загрузить историю выбранного участника.')
    } finally {
      setLoading(false)
    }
  }, [participantProfileId])

  useEffect(() => {
    const timeout = setTimeout(() => void loadHistory(), 0)
    return () => clearTimeout(timeout)
  }, [loadHistory])

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">История прохождений</h1>
        <p className="mt-2 text-gray-600">Результаты вашего профиля и участников, которыми вы управляете.</p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <ParticipantProfileSelect
          value={participantProfileId}
          onChange={setParticipantProfileId}
          label="Участник"
        />
      </div>

      {loading && <Loader text="Загрузка истории..." />}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
      {!loading && !error && participantProfileId && history.length === 0 && (
        <p className="rounded-lg border bg-white p-5 text-gray-600">У этого участника пока нет прохождений.</p>
      )}

      {!loading && !error && history.map(attempt => {
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
    </div>
  )
}
