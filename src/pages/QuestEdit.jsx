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
  const [editMode, setEditMode] = useState(false)
  const [questTitle, setQuestTitle] = useState('')
  const [questDescription, setQuestDescription] = useState('')
  const [verificationOptions, setVerificationOptions] = useState(['gps'])
  const [maxAttempts, setMaxAttempts] = useState(0)
  const [isOpen, setIsOpen] = useState(true)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')

  // Опции места, выбранные для квеста
  const [locationOptions, setLocationOptions] = useState(['gps']) // по умолчанию

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
      setMaxAttempts(questData.max_attempts || 0)
      setQuestTitle(questData.title)
      setQuestDescription(questData.description || '')
      setIsOpen(questData.is_open !== undefined ? questData.is_open : true)
      setStartAt(questData.start_at ? new Date(questData.start_at).toISOString().slice(0, 16) : '')
      setEndAt(questData.end_at ? new Date(questData.end_at).toISOString().slice(0, 16) : '')

      // Загружаем опции места (если нет, ставим по умолчанию)
      const opts = Array.isArray(questData.location_options) ? questData.location_options : ['gps']
      setLocationOptions(opts)

      const optsVer = Array.isArray(questData.verification_options) ? questData.verification_options : ['gps']
      setVerificationOptions(optsVer)

      setStartAt(questData.start_at ? new Date(questData.start_at).toLocaleString('sv', { hour12: false }).replace(' ', 'T') : '')
      setEndAt(questData.end_at ? new Date(questData.end_at).toLocaleString('sv', { hour12: false }).replace(' ', 'T') : '')

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

  // Сохранение опций места при изменении
  async function updateLocationOptions(newOpts) {
    setLocationOptions(newOpts)
    try {
      const { error } = await supabase
        .from('quests')
        .update({ location_options: newOpts })
        .eq('id', id)
      if (error) throw error
      toast.success('Настройки места обновлены')
    } catch (err) {
      toast.error('Ошибка сохранения настроек: ' + err.message)
    }
  }

  async function updateVerificationOptions(newOpts) {
    setVerificationOptions(newOpts)
    try {
      const { error } = await supabase
        .from('quests')
        .update({ verification_options: newOpts })
        .eq('id', id)
      if (error) throw error
      toast.success('Настройки проверки обновлены')
    } catch (err) {
      toast.error('Ошибка сохранения: ' + err.message)
    }
  }

  function toggleVerificationOption(opt) {
    if (verificationOptions.includes(opt)) {
      if (verificationOptions.length <= 1) {
        toast.error('Должна быть выбрана как минимум одна опция')
        return
      }
      const newOpts = verificationOptions.filter(o => o !== opt)
      updateVerificationOptions(newOpts)
    } else {
      updateVerificationOptions([...verificationOptions, opt])
    }
  }

  async function updateQuest() {
    if (!questTitle.trim()) {
      toast.error('Название не может быть пустым')
      return
    }
    try {
      const { error } = await supabase
        .from('quests')
        .update({
          title: questTitle.trim(),
          description: questDescription.trim() || null,
        })
        .eq('id', id)
      if (error) throw error
      setQuest((prev) => ({
        ...prev,
        title: questTitle.trim(),
        description: questDescription.trim() || null,
      }))
      setEditMode(false)
      toast.success('Квест обновлён')
    } catch (err) {
      toast.error('Ошибка обновления: ' + err.message)
    }
  }

  async function updateMaxAttempts(value) {
    const num = parseInt(value, 10) || 0
    setMaxAttempts(num)
    try {
      const { error } = await supabase
        .from('quests')
        .update({ max_attempts: num })
        .eq('id', id)
      if (error) throw error
      toast.success('Лимит попыток обновлён')
    } catch (err) {
      toast.error('Ошибка обновления: ' + err.message)
    }
  }

  async function updateAvailability(field, value) {
    let finalValue = value
    if ((field === 'start_at' || field === 'end_at') && value) {
      finalValue = new Date(value).toISOString()
    }

    try {
      const { error } = await supabase
        .from('quests')
        .update({ [field]: finalValue })
        .eq('id', id)
      if (error) throw error

      // Обновляем локальные состояния
      if (field === 'is_open') {
        setIsOpen(value)
      } else if (field === 'start_at') {
        setStartAt(value || '')
      } else if (field === 'end_at') {
        setEndAt(value || '')
      }

      // Также обновляем объект quest
      setQuest(prev => ({
        ...prev,
        [field]: finalValue
      }))

      toast.success('Настройки доступности обновлены')
    } catch (err) {
      toast.error('Ошибка обновления: ' + err.message)
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
      location_text: '',
      location_image_url: '',
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
      location_text: task.location_text || '',
      location_image_url: task.location_image_url || '',
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

  // Переключатели для опций места
  function toggleOption(opt) {
    let newOpts
    if (locationOptions.includes(opt)) {
      if (locationOptions.length <= 1) {
        toast.error('Должна быть выбрана как минимум одна опция')
        return
      }
      newOpts = locationOptions.filter(o => o !== opt)
    } else {
      newOpts = [...locationOptions, opt]
    }
    updateLocationOptions(newOpts)
  }

  if (loading) return <Loader text="Загрузка квеста..." />
  if (!quest) return <div className="p-8 text-center text-red-500">Квест не найден</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Редактирование названия и описания квеста */}
      <div className="flex items-start gap-2 mb-6">
        {editMode ? (
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={questTitle}
              onChange={(e) => setQuestTitle(e.target.value)}
              className="w-full border p-2 rounded text-xl font-bold"
              placeholder="Название квеста"
            />
            <textarea
              value={questDescription}
              onChange={(e) => setQuestDescription(e.target.value)}
              className="w-full border p-2 rounded"
              rows="2"
              placeholder="Описание квеста"
            />
            {/* Доступность и время */}
            <div className="mt-6 border-t pt-4">
              <h3 className="font-semibold mb-3">Доступность квеста</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isOpen}
                    onChange={(e) => {
                      setIsOpen(e.target.checked)
                      updateAvailability('is_open', e.target.checked)
                    }}
                  />
                  Квест открыт для прохождения
                </label>

                <div>
                  <label className="block text-sm font-medium">Дата и время начала (опционально)</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => {
                      setStartAt(e.target.value)
                      updateAvailability('start_at', e.target.value || null)
                    }}
                    className="w-full border p-2 rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">Дата и время завершения (опционально)</label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => {
                      setEndAt(e.target.value)
                      updateAvailability('end_at', e.target.value || null)
                    }}
                    className="w-full border p-2 rounded"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">Лимит попыток на ответ</label>
              <input
                type="number"
                min="0"
                value={maxAttempts}
                onChange={(e) => updateMaxAttempts(e.target.value)}
                className="w-full border p-2 rounded"
              />
              <p className="text-sm text-gray-500 mt-1">0 — неограниченно</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={updateQuest}
                className="bg-green-500 text-white px-4 py-1 rounded hover:bg-green-600"
              >
                Сохранить
              </button>
              <button
                onClick={() => {
                  setEditMode(false)
                  setQuestTitle(quest.title)
                  setQuestDescription(quest.description || '')
                }}
                className="bg-gray-300 text-gray-700 px-4 py-1 rounded hover:bg-gray-400"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{quest.title}</h1>
            {quest.description && <p className="text-gray-600">{quest.description}</p>}
            <div className="mt-4 p-3 bg-gray-50 border rounded">
              <h4 className="font-semibold text-sm">Текущие настройки доступности:</h4>
              <ul className="text-sm text-gray-700 mt-1">
                <li>Статус: <span className={quest.is_open ? 'text-green-600' : 'text-red-600'}>{quest.is_open ? 'Открыт' : 'Закрыт'}</span></li>
                {quest.start_at && <li>Начало: {new Date(quest.start_at).toLocaleString()}</li>}
                {quest.end_at && <li>Окончание: {new Date(quest.end_at).toLocaleString()}</li>}
              </ul>
            </div>
          </div>
          
        )}
        <button
          onClick={() => setEditMode(true)}
          className="text-blue-500 hover:text-blue-700 text-sm"
          title="Редактировать квест"
        >
          ✏️
        </button>
      </div>
      {/* Блок текущего состояния доступности */}
      

      {/* Блок выбора опций места */}
      <div className="bg-gray-50 p-4 rounded mb-6 border">
        <h3 className="font-semibold mb-2">Как будет описано место каждого задания?</h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={locationOptions.includes('gps')}
              onChange={() => toggleOption('gps')}
            />
            📍 GPS-координаты
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={locationOptions.includes('text')}
              onChange={() => toggleOption('text')}
            />
            📝 Текстовое описание
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={locationOptions.includes('image')}
              onChange={() => toggleOption('image')}
            />
            🖼️ Изображение
          </label>
        </div>
        <p className="text-sm text-gray-500 mt-2">Выберите хотя бы один вариант. Эти настройки будут применены ко всем заданиям квеста.</p>
      </div>

      {/* Блок выбора опций проверки */}
      <div className="bg-gray-50 p-4 rounded mb-6 border">
        <h3 className="font-semibold mb-2">Как проверять нахождение на месте?</h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={verificationOptions.includes('gps')}
              onChange={() => toggleVerificationOption('gps')}
            />
            📍 GPS-координаты
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={verificationOptions.includes('code')}
              onChange={() => toggleVerificationOption('code')}
            />
            🔑 Код доступа
          </label>
        </div>
        <p className="text-sm text-gray-500 mt-2">Выберите хотя бы один вариант. Участник должен будет подтвердить нахождение по выбранным условиям.</p>
      </div>

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
                  {task.gps_point?.coordinates && (
                    <span className="text-xs text-gray-500 ml-2">
                      📍 {task.gps_point.coordinates[1].toFixed(6)}, {task.gps_point.coordinates[0].toFixed(6)}
                    </span>
                  )}
                  {task.location_text && <span className="text-xs text-blue-500 ml-2">📝 {task.location_text.substring(0, 20)}...</span>}
                  {task.location_image_url && <span className="text-xs text-green-500 ml-2">🖼️ есть фото</span>}
                  {task.static_code && <span className="text-xs text-gray-500 ml-2">🔑 {task.static_code}</span>}
                  {task.correct_answer && <span className="text-xs text-purple-500 ml-2">✔ {task.correct_answer}</span>}
                  {task.options && Array.isArray(task.options) && task.options.length > 0 && (
                    <span className="text-xs text-indigo-500 ml-2">📋 варианты: {task.options.length}</span>
                  )}
                  {task.media_url && <span className="text-xs text-red-500 ml-2">🎬 медиа</span>}
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

          {/* Динамические поля места в зависимости от опций */}
          {locationOptions.includes('gps') && (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Широта"
                  value={taskForm.gps_lat}
                  onChange={e => setTaskForm({...taskForm, gps_lat: e.target.value})}
                  className="w-1/2 border p-2 rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Долгота"
                  value={taskForm.gps_lng}
                  onChange={e => setTaskForm({...taskForm, gps_lng: e.target.value})}
                  className="w-1/2 border p-2 rounded"
                  required
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
              required
            />
          )}

          {locationOptions.includes('image') && (
            <input
              type="text"
              placeholder="Ссылка на изображение места *"
              value={taskForm.location_image_url}
              onChange={e => setTaskForm({...taskForm, location_image_url: e.target.value})}
              className="w-full border p-2 rounded"
              required
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