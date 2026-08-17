import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

export default function QuestEdit({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quest, setQuest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [questTitle, setQuestTitle] = useState('')
  const [questDescription, setQuestDescription] = useState('')
  const [verificationOptions, setVerificationOptions] = useState(['gps'])
  const [maxAttempts, setMaxAttempts] = useState(0)
  const [isOpen, setIsOpen] = useState(true)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [locationOptions, setLocationOptions] = useState(['gps'])

  const userId = session?.user?.id

  const fetchQuest = useCallback(async () => {
    setLoading(true)
    try {
      const { data: questData, error: questError } = await supabase
        .from('quests')
        .select('*')
        .eq('id', id)
        .single()
      if (questError) throw new Error('Квест не найден')
      if (questData.creator_id !== userId) {
        navigate('/quests')
        return
      }
      setQuest(questData)
      setMaxAttempts(questData.max_attempts || 0)
      setQuestTitle(questData.title)
      setQuestDescription(questData.description || '')
      setIsOpen(questData.is_open !== undefined ? questData.is_open : true)

      const opts = Array.isArray(questData.location_options) ? questData.location_options : ['gps']
      setLocationOptions(opts)

      const optsVer = Array.isArray(questData.verification_options) ? questData.verification_options : ['gps']
      setVerificationOptions(optsVer)

      setStartAt(questData.start_at ? new Date(questData.start_at).toISOString().slice(0, 16) : '')
      setEndAt(questData.end_at ? new Date(questData.end_at).toISOString().slice(0, 16) : '')
    } catch (err) {
      toast.error(err.message)
      navigate('/quests')
    } finally {
      setLoading(false)
    }
  }, [id, userId, navigate])

  useEffect(() => {
    if (!id) return
    fetchQuest()
  }, [id, fetchQuest])

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

      if (field === 'is_open') {
        setIsOpen(value)
      } else if (field === 'start_at') {
        setStartAt(value || '')
      } else if (field === 'end_at') {
        setEndAt(value || '')
      }
      setQuest(prev => ({ ...prev, [field]: finalValue }))
      toast.success('Настройки доступности обновлены')
    } catch (err) {
      toast.error('Ошибка обновления: ' + err.message)
    }
  }

  if (loading) return <Loader text="Загрузка квеста..." />
  if (!quest) return <div className="p-8 text-center text-red-500">Квест не найден</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
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

      {/* Ссылка на управление заданиями */}
      <div className="border-t pt-4 mt-4">
        <h3 className="text-lg font-semibold mb-2">Управление заданиями</h3>
        <Link
          to={`/quests/${id}/tasks`}
          className="inline-block bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Перейти к заданиям
        </Link>
      </div>

      <div className="mt-6">
        <button
          onClick={() => navigate('/quests')}
          className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
        >
          ← Назад к списку квестов
        </button>
      </div>
    </div>
  )
}