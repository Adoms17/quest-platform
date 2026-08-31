import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

const TIMING_CONFIDENCE_LABELS = {
  trusted: '✅ Серверное',
  bounded: '⚠️ Ограниченное',
  reported: '📱 С устройства',
}

export default function QuestStats({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quest, setQuest] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState('percent_success')
  const [sortDirection, setSortDirection] = useState('desc')
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    async function fetchStats() {
      setLoading(true)
      try {
        const { data: questData, error: questError } = await supabase
          .from('quests')
          .select('*')
          .eq('id', id)
          .single()
        if (questError) throw questError
        if (questData.creator_id !== session.user.id) {
          toast.error('У вас нет прав на просмотр этой статистики')
          navigate('/quests')
          return
        }
        setQuest(questData)

        const { data: attemptsData, error: attemptsError } = await supabase
          .from('quest_attempts')
          .select(`
            *,
            profiles:user_id (id, username),
            task_attempts (
              id,
              opened,
              attempts_used,
              completed,
              failed,
              time_spent,
              trusted_time_seconds,
              reported_offline_time_seconds,
              timing_confidence,
              tasks:task_id (id, title)
            )
          `)
          .eq('quest_id', id)
          .order('created_at', { ascending: false })

        if (attemptsError) throw attemptsError
        setAttempts(attemptsData || [])
      } catch (err) {
        toast.error('Ошибка загрузки статистики: ' + err.message)
        navigate('/quests')
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [id, session, navigate])

  // Функция очистки статистики
  async function clearStats() {
    if (!window.confirm('Вы уверены, что хотите удалить всю статистику по этому квесту? Это действие необратимо.')) return

    setClearing(true)
    try {
      // Удаляем все quest_attempts для этого квеста (каскадное удаление task_attempts настроено в БД)
      const { error } = await supabase
        .from('quest_attempts')
        .delete()
        .eq('quest_id', id)

      if (error) throw error
      toast.success('Статистика очищена')
      setAttempts([]) // очищаем локальное состояние
    } catch (err) {
      toast.error('Ошибка очистки: ' + err.message)
    } finally {
      setClearing(false)
    }
  }

  // Функция сортировки
  function handleSort(field) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const sortedAttempts = [...attempts].sort((a, b) => {
    let aVal = a[sortField] ?? 0
    let bVal = b[sortField] ?? 0
    if (sortField === 'username') {
      aVal = a.profiles?.username || 'Аноним'
      bVal = b.profiles?.username || 'Аноним'
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    if (sortField === 'percent_success') {
      aVal = a.total_tasks > 0 ? (a.completed_tasks / a.total_tasks) * 100 : 0
      bVal = b.total_tasks > 0 ? (b.completed_tasks / b.total_tasks) * 100 : 0
    }
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })

  if (loading) return <Loader text="Загрузка статистики..." />
  if (!quest) return <div>Квест не найден</div>

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Статистика квеста</h1>
          <h2 className="text-xl text-gray-700">{quest.title}</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/quests')}
            className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            ← К списку квестов
          </button>
          <button
            onClick={clearStats}
            disabled={clearing || attempts.length === 0}
            className={`px-4 py-2 rounded text-white ${
              clearing || attempts.length === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {clearing ? 'Очистка...' : '🗑️ Очистить статистику'}
          </button>
        </div>
      </div>

      {sortedAttempts.length === 0 ? (
        <p className="text-gray-500">Пока никто не проходил этот квест.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('username')}>
                  Пользователь {sortField === 'username' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('started_at')}>
                  Начало {sortField === 'started_at' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('finished_at')}>
                  Завершение {sortField === 'finished_at' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('completed_tasks')}>
                  ✅ Успешно {sortField === 'completed_tasks' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('failed_tasks')}>
                  ❌ Неуспешно {sortField === 'failed_tasks' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('total_attempts')}>
                  Попыток {sortField === 'total_attempts' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('trusted_time_seconds')}>
                  Время сервера (сек) {sortField === 'trusted_time_seconds' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('reported_offline_time_seconds')}>
                  Offline-время (сек) {sortField === 'reported_offline_time_seconds' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border">
                  Доверие ко времени
                </th>
                <th className="py-2 px-4 border cursor-pointer hover:bg-gray-200" onClick={() => handleSort('percent_success')}>
                  % успеха {sortField === 'percent_success' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="py-2 px-4 border">Детали</th>
              </tr>
            </thead>
            <tbody>
              {sortedAttempts.map((attempt) => {
                const percent = attempt.total_tasks > 0
                  ? Math.round((attempt.completed_tasks / attempt.total_tasks) * 100)
                  : 0
                const taskDetails = attempt.task_attempts || []
                return (
                  <tr key={attempt.id} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border">{attempt.profiles?.username || 'Аноним'}</td>
                    <td className="py-2 px-4 border">{new Date(attempt.started_at).toLocaleString()}</td>
                    <td className="py-2 px-4 border">
                      {attempt.finished_at ? new Date(attempt.finished_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 px-4 border">{attempt.completed_tasks}</td>
                    <td className="py-2 px-4 border">{attempt.failed_tasks}</td>
                    <td className="py-2 px-4 border">{attempt.total_attempts || 0}</td>
                    <td className="py-2 px-4 border">
                      {attempt.trusted_time_seconds ?? attempt.total_time ?? 0}
                    </td>
                    <td className="py-2 px-4 border">{attempt.reported_offline_time_seconds || 0}</td>
                    <td className="py-2 px-4 border">
                      {TIMING_CONFIDENCE_LABELS[attempt.timing_confidence] || '—'}
                    </td>
                    <td className="py-2 px-4 border font-semibold">{percent}%</td>
                    <td className="py-2 px-4 border">
                      <details>
                        <summary className="text-blue-500 cursor-pointer">Показать задания</summary>
                        <ul className="mt-2 text-sm space-y-1">
                          {taskDetails.map((t) => (
                            <li key={t.id} className="border-b pb-1">
                              <span className="font-medium">{t.tasks?.title || 'Без названия'}</span>
                              <br />
                              <span className="text-xs">
                                {t.opened ? '🔓 открыто' : '🔒 закрыто'} |
                                попыток: {t.attempts_used || 0} |
                                {t.completed && ' ✅ успешно'} {t.failed && ' ❌ неуспешно'} |
                                сервер: {t.trusted_time_seconds ?? t.time_spent ?? 0} сек |
                                offline: {t.reported_offline_time_seconds || 0} сек |
                                {TIMING_CONFIDENCE_LABELS[t.timing_confidence] || '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => navigate(`/quests/${id}/edit`)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          ← Назад к редактированию
        </button>
        {/* Дополнительная кнопка "Назад к списку" уже есть вверху */}
      </div>
    </div>
  )
}