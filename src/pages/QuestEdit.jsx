import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import MapPicker from '../components/MapPicker'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function QuestEdit({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editingTask, setEditingTask] = useState(null)

  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    hint: '',
    gps_lat: '',
    gps_lng: '',
    static_code: '',
    correct_answer: '',
    options: '',          // строка, разделённая запятыми
    media_url: '',
    order_index: 0,
  })

  useEffect(() => {
    if (!id) return
    fetchQuestAndTasks()
  }, [id])

  async function fetchQuestAndTasks() {
    setLoading(true)
    try {
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

      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('quest_id', id)
        .order('order_index', { ascending: true })
      if (tasksError) throw tasksError
      setTasks(tasksData || [])
    } catch (err) {
      toast.error(err.message)
      navigate('/quests')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setTaskForm({
      title: '',
      description: '',
      hint: '',
      gps_lat: '',
      gps_lng: '',
      static_code: '',
      correct_answer: '',
      options: '',
      media_url: '',
      order_index: 0,
    })
    setEditingTask(null)
  }

  function startEdit(task) {
    let lat = ''
    let lng = ''
    if (task.gps_point && task.gps_point.coordinates) {
      lng = task.gps_point.coordinates[0].toString()
      lat = task.gps_point.coordinates[1].toString()
    }
    // Если options — массив, объединяем в строку через запятую
    const optionsStr = Array.isArray(task.options) ? task.options.join(', ') : ''
    setTaskForm({
      title: task.title || '',
      description: task.description || '',
      hint: task.hint || '',
      gps_lat: lat,
      gps_lng: lng,
      static_code: task.static_code || '',
      correct_answer: task.correct_answer || '',
      options: optionsStr,
      media_url: task.media_url || '',
      order_index: task.order_index || 0,
    })
    setEditingTask(task)
  }

  function validateCoords(lat, lng) {
    if (!lat && !lng) return true
    if (!lat || !lng) {
      toast.error('Если указываете координаты, заполните оба поля')
      return false
    }
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || isNaN(lngNum)) {
      toast.error('Координаты должны быть числами')
      return false
    }
    if (latNum < -90 || latNum > 90) {
      toast.error('Широта должна быть в диапазоне -90..90')
      return false
    }
    if (lngNum < -180 || lngNum > 180) {
      toast.error('Долгота должна быть в диапазоне -180..180')
      return false
    }
    return true
  }

  async function handleSaveTask(e) {
    e.preventDefault()
    if (!taskForm.title.trim()) {
      toast.error('Введите название задания')
      return
    }

    const { gps_lat, gps_lng, options, correct_answer, media_url } = taskForm
    if (!validateCoords(gps_lat, gps_lng)) return

    setSaving(true)

    // Преобразуем строку options в массив
    let optionsArray = null
    if (options.trim()) {
      optionsArray = options.split(',').map(s => s.trim()).filter(s => s.length > 0)
      if (optionsArray.length === 0) optionsArray = null
    }

    const taskData = {
      quest_id: id,
      title: taskForm.title.trim(),
      description: taskForm.description.trim() || null,
      hint: taskForm.hint.trim() || null,
      gps_point: (gps_lat && gps_lng)
        ? `POINT(${parseFloat(gps_lng)} ${parseFloat(gps_lat)})`
        : null,
      static_code: taskForm.static_code.trim() || null,
      correct_answer: correct_answer.trim() || null,
      options: optionsArray,
      media_url: media_url.trim() || null,
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

      if (editingTask) {
        setTasks(tasks.map(t => t.id === editingTask.id ? result.data[0] : t))
        toast.success('Задание обновлено')
      } else {
        setTasks([...tasks, result.data[0]])
        toast.success('Задание добавлено')
      }
      resetForm()
    } catch (err) {
      toast.error('Ошибка сохранения: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteTask(taskId) {
    if (!confirm('Удалить задание?')) return
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) toast.error('Ошибка удаления')
    else {
      setTasks(tasks.filter(t => t.id !== taskId))
      toast.success('Задание удалено')
    }
  }

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
                  {task.gps_point?.coordinates && (
                    <span className="text-xs text-gray-500 ml-2">
                      📍 {task.gps_point.coordinates[1].toFixed(6)}, {task.gps_point.coordinates[0].toFixed(6)}
                    </span>
                  )}
                  {task.static_code && <span className="text-xs text-gray-500 ml-2">🔑 {task.static_code}</span>}
                  {task.correct_answer && <span className="text-xs text-blue-500 ml-2">✔ {task.correct_answer}</span>}
                  {task.options && Array.isArray(task.options) && task.options.length > 0 && (
                    <span className="text-xs text-purple-500 ml-2">📋 варианты: {task.options.length}</span>
                  )}
                  {task.media_url && <span className="text-xs text-green-500 ml-2">🎬 медиа</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(task)} className="text-blue-500 hover:text-blue-700 text-sm">Изменить</button>
                  <button onClick={() => deleteTask(task.id)} className="text-red-500 hover:text-red-700 text-sm">Удалить</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t pt-4">
        <h3 className="text-lg font-semibold mb-3">
          {editingTask ? 'Редактировать задание' : 'Добавить задание'}
        </h3>
        <form onSubmit={handleSaveTask} className="space-y-3">
          <input
            type="text"
            placeholder="Название задания *"
            value={taskForm.title}
            onChange={e => setTaskForm({...taskForm, title: e.target.value})}
            className="w-full border p-2 rounded"
            required
          />
          <textarea
            placeholder="Описание задания"
            value={taskForm.description}
            onChange={e => setTaskForm({...taskForm, description: e.target.value})}
            className="w-full border p-2 rounded"
            rows="2"
          />
          <input
            type="text"
            placeholder="Подсказка"
            value={taskForm.hint}
            onChange={e => setTaskForm({...taskForm, hint: e.target.value})}
            className="w-full border p-2 rounded"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Широта"
              value={taskForm.gps_lat}
              onChange={e => setTaskForm({...taskForm, gps_lat: e.target.value})}
              className="w-1/2 border p-2 rounded"
            />
            <input
              type="text"
              placeholder="Долгота"
              value={taskForm.gps_lng}
              onChange={e => setTaskForm({...taskForm, gps_lng: e.target.value})}
              className="w-1/2 border p-2 rounded"
            />
          </div>
          <MapPicker
            initialLat={taskForm.gps_lat ? parseFloat(taskForm.gps_lat) : null}
            initialLng={taskForm.gps_lng ? parseFloat(taskForm.gps_lng) : null}
            onSelect={handleMapSelect}
          />
          <input
            type="text"
            placeholder="Статический код (например, ABC123)"
            value={taskForm.static_code}
            onChange={e => setTaskForm({...taskForm, static_code: e.target.value})}
            className="w-full border p-2 rounded"
          />
          <input
            type="text"
            placeholder="Правильный ответ (текст)"
            value={taskForm.correct_answer}
            onChange={e => setTaskForm({...taskForm, correct_answer: e.target.value})}
            className="w-full border p-2 rounded"
          />
          <input
            type="text"
            placeholder="Варианты ответа (через запятую, например: Москва, Санкт-Петербург, Новосибирск)"
            value={taskForm.options}
            onChange={e => setTaskForm({...taskForm, options: e.target.value})}
            className="w-full border p-2 rounded"
          />
          <input
            type="text"
            placeholder="Ссылка на медиа (изображение, аудио, видео)"
            value={taskForm.media_url}
            onChange={e => setTaskForm({...taskForm, media_url: e.target.value})}
            className="w-full border p-2 rounded"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
              {saving ? 'Сохранение...' : editingTask ? 'Обновить задание' : 'Добавить задание'}
            </button>
            {editingTask && (
              <button type="button" onClick={resetForm} className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400">
                Отменить
              </button>
            )}
          </div>
        </form>
        <button onClick={() => navigate('/quests')} className="mt-4 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400">
          Назад к списку
        </button>
      </div>
    </div>
  )
}