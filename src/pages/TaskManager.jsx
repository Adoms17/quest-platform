import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function TaskManager() {
  const { id } = useParams()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [questTitle, setQuestTitle] = useState('')
  const [moving, setMoving] = useState(false)

  const fetchQuestTitle = useCallback(async () => {
    const { data, error } = await supabase
      .from('quests')
      .select('title')
      .eq('id', id)
      .single()
    if (!error && data) setQuestTitle(data.title)
  }, [id])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('quest_id', id)
      .order('order_index', { ascending: true })
    if (error) {
      toast.error('Ошибка загрузки заданий: ' + error.message)
    } else {
      setTasks(data || [])
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchQuestTitle()
    fetchTasks()
  }, [fetchQuestTitle, fetchTasks])

  async function handleDelete(taskId) {
    if (!confirm('Удалить задание?')) return
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) {
      toast.error('Ошибка удаления: ' + error.message)
    } else {
      toast.success('Задание удалено')
      setTasks(tasks.filter(t => t.id !== taskId))
    }
  }

  async function moveTaskUp(index) {
    if (index === 0) return
    setMoving(true)
    const task = tasks[index]
    const prevTask = tasks[index - 1]
    // Меняем order_index местами
    const tempOrder = task.order_index
    task.order_index = prevTask.order_index
    prevTask.order_index = tempOrder

    // Обновляем в БД
    try {
      const { error: err1 } = await supabase
        .from('tasks')
        .update({ order_index: task.order_index })
        .eq('id', task.id)
      if (err1) throw err1

      const { error: err2 } = await supabase
        .from('tasks')
        .update({ order_index: prevTask.order_index })
        .eq('id', prevTask.id)
      if (err2) throw err2

      // Обновляем локальное состояние
      const newTasks = [...tasks]
      newTasks[index] = prevTask
      newTasks[index - 1] = task
      setTasks(newTasks)
      toast.success('Порядок обновлён')
    } catch (err) {
      toast.error('Ошибка перемещения: ' + err.message)
      // Откатываем изменения в локальном состоянии (перезагружаем)
      await fetchTasks()
    } finally {
      setMoving(false)
    }
  }

  async function moveTaskDown(index) {
    if (index === tasks.length - 1) return
    setMoving(true)
    const task = tasks[index]
    const nextTask = tasks[index + 1]
    const tempOrder = task.order_index
    task.order_index = nextTask.order_index
    nextTask.order_index = tempOrder

    try {
      const { error: err1 } = await supabase
        .from('tasks')
        .update({ order_index: task.order_index })
        .eq('id', task.id)
      if (err1) throw err1

      const { error: err2 } = await supabase
        .from('tasks')
        .update({ order_index: nextTask.order_index })
        .eq('id', nextTask.id)
      if (err2) throw err2

      const newTasks = [...tasks]
      newTasks[index] = nextTask
      newTasks[index + 1] = task
      setTasks(newTasks)
      toast.success('Порядок обновлён')
    } catch (err) {
      toast.error('Ошибка перемещения: ' + err.message)
      await fetchTasks()
    } finally {
      setMoving(false)
    }
  }

  if (loading) return <Loader text="Загрузка заданий..." />

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Управление заданиями</h1>
          <p className="text-gray-600">{questTitle}</p>
        </div>
        <Link
          to={`/quests/${id}/tasks/new`}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          + Добавить задание
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-gray-500">В этом квесте пока нет заданий.</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task, idx) => (
            <li key={task.id} className="border p-4 rounded shadow flex justify-between items-center">
              <div className="flex items-center gap-3 flex-1">
                <span className="font-medium text-gray-500">#{idx + 1}</span>
                <span className="font-medium">{task.title}</span>
                {task.gps_point?.coordinates && (
                  <span className="text-xs text-gray-500 ml-2">
                    📍 {task.gps_point.coordinates[1].toFixed(6)}, {task.gps_point.coordinates[0].toFixed(6)}
                  </span>
                )}
                {task.location_text && (
                  <span className="text-xs text-blue-500 ml-2">📝 {task.location_text.substring(0, 20)}...</span>
                )}
                {task.location_image_url && <span className="text-xs text-green-500 ml-2">🖼️ есть фото</span>}
                {task.static_code && <span className="text-xs text-gray-500 ml-2">🔑 {task.static_code}</span>}
                {task.correct_answer && <span className="text-xs text-purple-500 ml-2">✔ {task.correct_answer}</span>}
                {task.options && Array.isArray(task.options) && task.options.length > 0 && (
                  <span className="text-xs text-indigo-500 ml-2">📋 варианты: {task.options.length}</span>
                )}
                {task.media_url && <span className="text-xs text-red-500 ml-2">🎬 медиа</span>}
              </div>
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => moveTaskUp(idx)}
                  disabled={idx === 0 || moving}
                  className="px-2 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-40"
                  title="Переместить вверх"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveTaskDown(idx)}
                  disabled={idx === tasks.length - 1 || moving}
                  className="px-2 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-40"
                  title="Переместить вниз"
                >
                  ↓
                </button>
                <Link
                  to={`/quests/${id}/tasks/${task.id}/edit`}
                  className="text-blue-500 hover:text-blue-700 text-sm ml-2"
                >
                  ✏️
                </Link>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex gap-2">
        <Link
          to={`/quests/${id}/edit`}
          className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
        >
          ← Назад к редактированию квеста
        </Link>
      </div>
    </div>
  )
}