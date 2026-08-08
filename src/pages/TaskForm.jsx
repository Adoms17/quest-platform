import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import MapPicker from '../components/MapPicker'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function TaskForm({ session }) {
  const { id, taskId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locationOptions, setLocationOptions] = useState(['gps']) // по умолчанию

  // Загружаем настройки квеста (location_options)
  useEffect(() => {
    async function fetchQuestOptions() {
      const { data, error } = await supabase
        .from('quests')
        .select('location_options')
        .eq('id', id)
        .single()
      if (!error && data?.location_options) {
        setLocationOptions(data.location_options)
      }
    }
    fetchQuestOptions()
  }, [id])

  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    hint: '',
    gps_lat: '',
    gps_lng: '',
    static_code: '',
    correct_answer: '',
    options: '',
    media_url: '',
    location_text: '',
    location_image_url: '',
    order_index: 0,
  })

  const isEdit = !!taskId

  useEffect(() => {
    if (isEdit) {
      fetchTask()
    }
  }, [taskId])

  async function fetchTask() {
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()
    if (error) {
      toast.error('Ошибка загрузки задания: ' + error.message)
      navigate(`/quests/${id}/tasks`)
    } else if (data) {
      let lat = '', lng = ''
      if (data.gps_point && data.gps_point.coordinates) {
        lng = data.gps_point.coordinates[0].toString()
        lat = data.gps_point.coordinates[1].toString()
      }
      const optionsStr = Array.isArray(data.options) ? data.options.join(', ') : ''
      setTaskForm({
        title: data.title || '',
        description: data.description || '',
        hint: data.hint || '',
        gps_lat: lat,
        gps_lng: lng,
        static_code: data.static_code || '',
        correct_answer: data.correct_answer || '',
        options: optionsStr,
        media_url: data.media_url || '',
        location_text: data.location_text || '',
        location_image_url: data.location_image_url || '',
        order_index: data.order_index || 0,
      })
    }
    setLoading(false)
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

  async function handleSubmit(e) {
    e.preventDefault()
    if (!taskForm.title.trim()) {
      toast.error('Введите название задания')
      return
    }

    // Проверяем обязательность полей в зависимости от опций места
    const opts = locationOptions
    const { gps_lat, gps_lng, location_text, location_image_url } = taskForm

    if (opts.includes('gps') && !gps_lat && !gps_lng) {
      toast.error('Для этого квеста обязательно указать GPS-координаты')
      return
    }
    if (opts.includes('gps') && !validateCoords(gps_lat, gps_lng)) return

    if (opts.includes('text') && !location_text.trim()) {
      toast.error('Для этого квеста обязательно указать текстовое описание места')
      return
    }
    if (opts.includes('image') && !location_image_url.trim()) {
      toast.error('Для этого квеста обязательно указать изображение места')
      return
    }

    setSaving(true)

    let optionsArray = null
    if (taskForm.options.trim()) {
      optionsArray = taskForm.options.split(',').map(s => s.trim()).filter(s => s.length > 0)
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
      correct_answer: taskForm.correct_answer.trim() || null,
      options: optionsArray,
      media_url: taskForm.media_url.trim() || null,
      location_text: taskForm.location_text.trim() || null,
      location_image_url: taskForm.location_image_url.trim() || null,
      order_index: taskForm.order_index || 0,
    }

    try {
      let result
      if (isEdit) {
        result = await supabase
          .from('tasks')
          .update(taskData)
          .eq('id', taskId)
          .select()
      } else {
        result = await supabase
          .from('tasks')
          .insert(taskData)
          .select()
      }
      if (result.error) throw result.error

      toast.success(isEdit ? 'Задание обновлено' : 'Задание добавлено')
      navigate(`/quests/${id}/tasks`)
    } catch (err) {
      toast.error('Ошибка сохранения: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleMapSelect(lat, lng) {
    setTaskForm(prev => ({
      ...prev,
      gps_lat: lat.toString(),
      gps_lng: lng.toString(),
    }))
  }

  if (loading) return <Loader text="Загрузка задания..." />

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        {isEdit ? 'Редактировать задание' : 'Добавить задание'}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-3">
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
          placeholder="Ссылка на медиа (изображение, аудио, видео)"
          value={taskForm.media_url}
          onChange={e => setTaskForm({...taskForm, media_url: e.target.value})}
          className="w-full border p-2 rounded"
        />
        <input
          type="text"
          placeholder="Подсказка"
          value={taskForm.hint}
          onChange={e => setTaskForm({...taskForm, hint: e.target.value})}
          className="w-full border p-2 rounded"
        />
        <input
          type="text"
          placeholder="Варианты ответа (через запятую)"
          value={taskForm.options}
          onChange={e => setTaskForm({...taskForm, options: e.target.value})}
          className="w-full border p-2 rounded"
        />
        <input
          type="text"
          placeholder="Правильный ответ (текст)"
          value={taskForm.correct_answer}
          onChange={e => setTaskForm({...taskForm, correct_answer: e.target.value})}
          className="w-full border p-2 rounded"
        />

        {locationOptions.includes('gps') && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Широта"
                value={taskForm.gps_lat}
                onChange={e => setTaskForm({...taskForm, gps_lat: e.target.value})}
                className="w-1/2 border p-2 rounded"
                required={locationOptions.includes('gps')}
              />
              <input
                type="text"
                placeholder="Долгота"
                value={taskForm.gps_lng}
                onChange={e => setTaskForm({...taskForm, gps_lng: e.target.value})}
                className="w-1/2 border p-2 rounded"
                required={locationOptions.includes('gps')}
              />
            </div>
            <MapPicker
              initialLat={taskForm.gps_lat ? parseFloat(taskForm.gps_lat) : null}
              initialLng={taskForm.gps_lng ? parseFloat(taskForm.gps_lng) : null}
              onSelect={handleMapSelect}
            />
          </>
        )}

        {locationOptions.includes('text') && (
          <textarea
            placeholder="Текстовое описание места *"
            value={taskForm.location_text}
            onChange={e => setTaskForm({...taskForm, location_text: e.target.value})}
            className="w-full border p-2 rounded"
            rows="2"
            required={locationOptions.includes('text')}
          />
        )}

        {locationOptions.includes('image') && (
          <input
            type="text"
            placeholder="Ссылка на изображение места *"
            value={taskForm.location_image_url}
            onChange={e => setTaskForm({...taskForm, location_image_url: e.target.value})}
            className="w-full border p-2 rounded"
            required={locationOptions.includes('image')}
          />
        )}

        <input
          type="text"
          placeholder="Статический код (например, ABC123)"
          value={taskForm.static_code}
          onChange={e => setTaskForm({...taskForm, static_code: e.target.value})}
          className="w-full border p-2 rounded"
        />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            {saving ? 'Сохранение...' : isEdit ? 'Обновить задание' : 'Добавить задание'}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/quests/${id}/tasks`)}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}