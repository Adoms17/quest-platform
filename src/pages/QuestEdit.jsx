import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import MapPicker from '../components/MapPicker'
import Loader from '../components/Loader'

export default function QuestEdit({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Состояние для редактируемого задания
  const [editingTask, setEditingTask] = useState(null) // объект задания или null

  // Поля нового задания (используем и для редактирования)
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    hint: '',
    gps_lat: '',
    gps_lng: '',
    static_code: '',
    correct_answer: '',
    order_index: 0,
  })

  // Загружаем квест и задания
  useEffect(() => {
    if (!id) return
    fetchQuestAndTasks()
  }, [id])

  async function fetchQuestAndTasks() {
    setLoading(true)
    try {
      // Загружаем квест
      const { data: questData, error: questError } = await supabase
        .from('quests')
        .select('*')
        .eq('id', id)
        .single()

      if (questError) throw new Error('Квест не найден')
      if (questData.creator_id !== session.user.id) {
        navigate('/quests')
        return
      }
      setQuest(questData)

      // Загружаем задания
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('quest_id', id)
        .order('order_index', { ascending: true })

      if (tasksError) throw tasksError
      setTasks(tasksData || [])
    } catch (err) {
      alert(err.message)
      navigate('/quests')
    } finally {
      setLoading(false)
    }
  }

  // Сброс формы с принудительной очисткой координат
  function resetForm() {
    setTaskForm({
      title: '',
      description: '',
      hint: '',
      gps_lat: '',
      gps_lng: '',
      static_code: '',
      correct_answer: '',
      order_index: 0,
    })
    setEditingTask(null)
  }

  // Заполнение формы для редактирования
  function startEdit(task) {
    // Извлекаем координаты из gps_point, если они есть
    let lat = ''
    let lng = ''
    if (task.gps_point && task.gps_point.coordinates) {
      lng = task.gps_point.coordinates[0].toString()
      lat = task.gps_point.coordinates[1].toString()
    }
    setTaskForm({
      title: task.title || '',
      description: task.description || '',
      hint: task.hint || '',
      gps_lat: lat,
      gps_lng: lng,
      static_code: task.static_code || '',
      correct_answer: task.correct_answer || '',
      order_index: task.order_index || 0,
    })
    setEditingTask(task)
  }

  // Валидация координат
  function validateCoords(lat, lng) {
    if (!lat && !lng) return true // оба пустые — ок
    if (!lat || !lng) {
      alert('Если указываете координаты, заполните оба поля')
      return false
    }
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || isNaN(lngNum)) {
      alert('Координаты должны быть числами')
      return false
    }
    if (latNum < -90 || latNum > 90) {
      alert('Широта должна быть в диапазоне -90..90')
      return false
    }
    if (lngNum < -180 || lngNum > 180) {
      alert('Долгота должна быть в диапазоне -180..180')
      return false
    }
    return true
  }

  // Сохранение (создание или обновление)
async function handleSaveTask(e) {
  e.preventDefault()
  if (!taskForm.title.trim()) {
    alert('Введите название задания')
    return
  }

  const { gps_lat, gps_lng } = taskForm
  if (!validateCoords(gps_lat, gps_lng)) return

  setSaving(true)

  const taskData = {
    quest_id: id,
    title: taskForm.title.trim(),
    description: taskForm.description.trim() || null,
    hint: taskForm.hint.trim() || null,
    gps_point: (gps_lat && gps_lng)
      ? `POINT(${parseFloat(gps_lng)} ${parseFloat(gps_lat)})`
      : null,
    static_code: taskForm.static_code.trim() || null,
    correct_answer: taskForm.correct_answer.trim() || null,
    order_index: taskForm.order_index || 0,
  }

  try {
    let result
    if (editingTask) {
      result = await supabase
        .from('tasks')
        .update(taskData)
        .eq('id', editingTask.id)
        .select()
    } else {
      result = await supabase
        .from('tasks')
        .insert(taskData)
        .select()
    }

    if (result.error) throw result.error

    // Обновляем список заданий
    if (editingTask) {
      setTasks(tasks.map(t => t.id === editingTask.id ? result.data[0] : t))
    } else {
      setTasks([...tasks, result.data[0]])
    }
    resetForm() // Очищаем форму
  } catch (err) {
    alert('Ошибка сохранения: ' + err.message)
  } finally {
    setSaving(false)
  }
}

  // Удаление задания
  async function deleteTask(taskId) {
    if (!confirm('Удалить задание?')) return
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) alert('Ошибка удаления')
    else setTasks(tasks.filter(t => t.id !== taskId))
  }

  // Обработчик выбора координат с карты
  function handleMapSelect(lat, lng) {
    setTaskForm(prev => ({
      ...prev,
      gps_lat: lat.toString(),
      gps_lng: lng.toString(),
    }))
  }

  if (loading) return <Loader text="Загрузка квеста..." />
  if (!quest) return <div className="p-8 text-center text-red-500">Квест не найден</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Редактирование квеста</h1>
      <h2 className="text-xl text-gray-700 mb-6">{quest.title}</h2>

      {/* Список заданий */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-2">Задания ({tasks.length})</h3>
        {tasks.length === 0 ? (
          <p className="text-gray-500">Пока нет заданий. Добавьте первое!</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task, idx) => (
              <li key={task.id} className="border p-3 rounded flex justify-between items-center">
                <div>
                  <span className="font-medium">#{idx+1}</span> {task.title}
                  {task.gps_point && task.gps_point.coordinates && (
                    <span className="text-xs text-gray-500 ml-2">
                      📍 {task.gps_point.coordinates[1].toFixed(6)}, {task.gps_point.coordinates[0].toFixed(6)}
                    </span>
                  )}
                  {task.static_code && (
                    <span className="text-xs text-gray-500 ml-2">🔑 {task.static_code}</span>
                  )}
                  {task.correct_answer && (
                    <span className="text-xs text-blue-500 ml-2">✔ {task.correct_answer}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(task)}
                    className="text-blue-500 hover:text-blue-700 text-sm"
                  >
                    Изменить
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Форма добавления/редактирования задания */}
      <div className="border-t pt-4">
        <h3 className="text-lg font-semibold mb-3">
          {editingTask ? 'Редактировать задание' : 'Добавить задание'}
        </h3>
        <form onSubmit={handleSaveTask} className="space-y-3">
          <input
            type="text"
            placeholder="Название задания *"
            value={taskForm.title}
            onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
            className="w-full border p-2 rounded"
            required
          />
          <textarea
            placeholder="Описание задания"
            value={taskForm.description}
            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            className="w-full border p-2 rounded"
            rows="2"
          />
          <input
            type="text"
            placeholder="Подсказка"
            value={taskForm.hint}
            onChange={(e) => setTaskForm({ ...taskForm, hint: e.target.value })}
            className="w-full border p-2 rounded"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Широта (например, 55.7558)"
              value={taskForm.gps_lat}
              onChange={(e) => setTaskForm({ ...taskForm, gps_lat: e.target.value })}
              className="w-1/2 border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Долгота (например, 37.6173)"
              value={taskForm.gps_lng}
              onChange={(e) => setTaskForm({ ...taskForm, gps_lng: e.target.value })}
              className="w-1/2 border p-2 rounded"
            />
          </div>
          {/* Компонент карты */}
          <MapPicker
            initialLat={taskForm.gps_lat ? parseFloat(taskForm.gps_lat) : null}
            initialLng={taskForm.gps_lng ? parseFloat(taskForm.gps_lng) : null}
            onSelect={handleMapSelect}
          />
          <input
            type="text"
            placeholder="Статический код (например, ABC123)"
            value={taskForm.static_code}
            onChange={(e) => setTaskForm({ ...taskForm, static_code: e.target.value })}
            className="w-full border p-2 rounded"
          />
          <input
            type="text"
            placeholder="Правильный ответ (текст)"
            value={taskForm.correct_answer}
            onChange={(e) => setTaskForm({ ...taskForm, correct_answer: e.target.value })}
            className="w-full border p-2 rounded"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              {saving ? 'Сохранение...' : editingTask ? 'Обновить задание' : 'Добавить задание'}
            </button>
            {editingTask && (
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
              >
                Отменить редактирование
              </button>
            )}
          </div>
        </form>
        <button
          onClick={() => navigate('/quests')}
          className="mt-4 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
        >
          Назад к списку
        </button>
      </div>
    </div>
  )
}