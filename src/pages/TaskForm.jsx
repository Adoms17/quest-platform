import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import MapPicker from '../components/MapPicker'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function TaskForm() {
  const { id, taskId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locationOptions, setLocationOptions] = useState(['gps'])

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
    location_text: '',
    location_image_url: '',
    order_index: 0,
  })
  const [mediaList, setMediaList] = useState([])
  const [newMedia, setNewMedia] = useState({ url: '', title: '', description: '' })

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
      const optionsText = Array.isArray(data.options) ? data.options.join('\n') : ''
      setTaskForm({
        title: data.title || '',
        description: data.description || '',
        hint: data.hint || '',
        gps_lat: lat,
        gps_lng: lng,
        static_code: data.static_code || '',
        correct_answer: data.correct_answer || '',
        options: optionsText,
        location_text: data.location_text || '',
        location_image_url: data.location_image_url || '',
        order_index: data.order_index || 0,
      })
      if (data.media && Array.isArray(data.media)) {
        setMediaList(data.media.map((item, idx) => ({ ...item, id: idx })))
      } else if (data.media_url) {
        setMediaList([{ id: 0, url: data.media_url, title: '', description: '' }])
      } else {
        setMediaList([])
      }
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

  function addMedia() {
    if (!newMedia.url.trim()) {
      toast.error('Введите URL медиа')
      return
    }
    if (mediaList.some(m => m.url.trim() === newMedia.url.trim())) {
      toast.error('Этот URL уже добавлен')
      return
    }
    const newItem = {
      id: Date.now(),
      url: newMedia.url.trim(),
      title: newMedia.title.trim(),
      description: newMedia.description.trim(),
    }
    setMediaList([...mediaList, newItem])
    setNewMedia({ url: '', title: '', description: '' })
  }

  function removeMedia(id) {
    setMediaList(mediaList.filter(item => item.id !== id))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!taskForm.title.trim()) {
      toast.error('Введите название задания')
      return
    }

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
      optionsArray = taskForm.options
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0)
      if (optionsArray.length === 0) optionsArray = null
    }

    const mediaData = mediaList.map(({ url, title, description }) => ({
      url,
      title: title || '',
      description: description || '',
    }))

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
      media: mediaData,
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
        
        {/* Блок медиа */}
        <div className="border p-3 rounded bg-gray-50">
          <h4 className="font-medium mb-2">Медиафайлы</h4>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="URL медиа"
                value={newMedia.url}
                onChange={e => setNewMedia({...newMedia, url: e.target.value})}
                className="flex-1 min-w-[200px] border p-2 rounded"
              />
              <input
                type="text"
                placeholder="Название (опционально)"
                value={newMedia.title}
                onChange={e => setNewMedia({...newMedia, title: e.target.value})}
                className="flex-1 min-w-[150px] border p-2 rounded"
              />
              <input
                type="text"
                placeholder="Описание (опционально)"
                value={newMedia.description}
                onChange={e => setNewMedia({...newMedia, description: e.target.value})}
                className="flex-1 min-w-[150px] border p-2 rounded"
              />
              <button
                type="button"
                onClick={addMedia}
                className="bg-green-500 text-white px-3 py-2 rounded hover:bg-green-600 whitespace-nowrap"
              >
                Добавить
              </button>
            </div>
            {mediaList.length > 0 && (
              <ul className="space-y-1">
                {mediaList.map((item) => (
                  <li key={item.id} className="flex justify-between items-center bg-white p-2 rounded border">
                    <span className="truncate flex-1">
                      {item.title ? `${item.title} (${item.url})` : item.url}
                      {item.description && <span className="text-sm text-gray-500 ml-2">— {item.description}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMedia(item.id)}
                      className="text-red-500 hover:text-red-700 text-sm ml-2"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">Добавьте ссылки на изображения, видео или аудио. Каждый файл можно снабдить названием и описанием.</p>
        </div>

        <input
          type="text"
          placeholder="Подсказка"
          value={taskForm.hint}
          onChange={e => setTaskForm({...taskForm, hint: e.target.value})}
          className="w-full border p-2 rounded"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Варианты ответов (каждый вариант на новой строке)
          </label>
          <textarea
            placeholder="Вариант 1&#10;Вариант 2&#10;Вариант 3"
            value={taskForm.options}
            onChange={e => setTaskForm({...taskForm, options: e.target.value})}
            className="w-full border p-2 rounded font-mono text-sm"
            rows="4"
          />
          <p className="text-xs text-gray-500 mt-1">Оставьте пустым, если вариантов нет (тогда будет текстовый ответ).</p>
        </div>
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