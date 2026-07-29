import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function QuestStats({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quest, setQuest] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      setLoading(true)
      try {
        // Получаем квест
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

        // Получаем все попытки для заданий этого квеста
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('quest_id', id)
        if (tasksError) throw tasksError

        const taskIds = tasksData.map(t => t.id)
        if (taskIds.length === 0) {
          setAttempts([])
          setLoading(false)
          return
        }

        // Получаем попытки с данными участников
        const { data: attemptsData, error: attemptsError } = await supabase
          .from('attempts')
          .select(`
            id,
            is_completed,
            time_spent,
            submitted_at,
            task_id,
            profiles:participant_id (id, username)
          `)
          .in('task_id', taskIds)
          .order('submitted_at', { ascending: false })

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

  if (loading) return <Loader text="Загрузка статистики..." />
  if (!quest) return <div>Квест не найден</div>

  // Группируем по участникам
  const grouped = attempts.reduce((acc, att) => {
    const key = att.profiles.id
    if (!acc[key]) {
      acc[key] = {
        username: att.profiles.username || 'Аноним',
        tasks: [],
        total_time: 0,
      }
    }
    acc[key].tasks.push({
      task_id: att.task_id,
      is_completed: att.is_completed,
      time_spent: att.time_spent,
    })
    if (att.time_spent) acc[key].total_time += att.time_spent
    return acc
  }, {})

  const participants = Object.entries(grouped).map(([userId, data]) => ({
    userId,
    ...data,
    completed: data.tasks.filter(t => t.is_completed).length,
    total: data.tasks.length,
  }))

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Статистика квеста</h1>
      <h2 className="text-xl text-gray-700 mb-6">{quest.title}</h2>

      {participants.length === 0 ? (
        <p className="text-gray-500">Пока никто не проходил этот квест.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border">Участник</th>
                <th className="py-2 px-4 border">Выполнено заданий</th>
                <th className="py-2 px-4 border">Общее время (сек)</th>
                <th className="py-2 px-4 border">Детали</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.userId} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border">{p.username}</td>
                  <td className="py-2 px-4 border">{p.completed} / {p.total}</td>
                  <td className="py-2 px-4 border">{p.total_time || 0}</td>
                  <td className="py-2 px-4 border">
                    <details>
                      <summary className="text-blue-500 cursor-pointer">Подробнее</summary>
                      <ul className="mt-1 text-sm">
                        {p.tasks.map((t, idx) => (
                          <li key={idx}>
                            Задание #{idx+1}: {t.is_completed ? '✅' : '❌'} {t.time_spent ? `${t.time_spent} сек` : '—'}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => navigate(`/quests/${id}/edit`)}
          className="mt-6 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          ← Назад к редактированию
        </button>
        <button
          onClick={() => navigate(`/quests`)}
          className="mt-6 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          ← Назад к списку
        </button>
      </div>
    </div>
  )
}