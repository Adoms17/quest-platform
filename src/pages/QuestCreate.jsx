import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import { useOrganization } from '../contexts/useOrganization'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function QuestCreate({ session }) {
  const navigate = useNavigate()
  const { currentOrganization, loadingOrganizations } = useOrganization()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [locationOptions, setLocationOptions] = useState(['gps'])
  const [verificationOptions, setVerificationOptions] = useState(['gps'])
  const [verificationMatchPolicy, setVerificationMatchPolicy] =
    useState('all')
  const [maxAttempts, setMaxAttempts] = useState(0)
  const [maxQuestAttempts, setMaxQuestAttempts] = useState(0)
  const [taskNavigationMode, setTaskNavigationMode] =
    useState('sequential')
  const [verificationMode, setVerificationMode] =
    useState('online')
  const [offlineProgressPolicy, setOfflineProgressPolicy] =
    useState('allow_pending')
  const [loading, setLoading] = useState(false)

  function toggleOption(opt) {
    if (opt === 'gps' && !locationOptions.includes('gps')) return

    if (verificationOptions.includes(opt)) {
      if (verificationOptions.length <= 1) {
        toast.error('Должна быть выбрана как минимум одна опция')
        return
      }
      setVerificationOptions(verificationOptions.filter(o => o !== opt))
    } else {
      setVerificationOptions([...verificationOptions, opt])
    }
  }

  function toggleLocationOption(opt) {
    if (locationOptions.includes(opt)) {
      if (locationOptions.length === 1) return

      setLocationOptions(locationOptions.filter(item => item !== opt))

      if (opt === 'gps') {
        const withoutGps = verificationOptions.filter(item => item !== 'gps')
        setVerificationOptions(withoutGps.length > 0 ? withoutGps : ['code'])
      }
    } else {
      setLocationOptions([...locationOptions, opt])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Введите название')
      return
    }
    if (!currentOrganization?.id) {
      toast.error('Выберите организацию для создания квеста')
      return
    }
    if (
      verificationOptions.includes('gps') &&
      !locationOptions.includes('gps')
    ) {
      toast.error('GPS-проверка требует GPS-координаты в описании места')
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('quests')
      .insert({
        creator_id: session.user.id,
        organization_id: currentOrganization.id,
        title: title.trim(),
        description: description.trim() || null,
        cover_image_url: coverImageUrl.trim() || null,
        is_public: isPublic,
        verification_options: verificationOptions,
        verification_match_policy: verificationMatchPolicy,
        verification_mode: verificationMode,
        offline_progress_policy: offlineProgressPolicy,
        location_options: locationOptions,
        max_attempts: parseInt(maxAttempts, 10) || 0,
        max_quest_attempts: parseInt(maxQuestAttempts, 10) || 0,
        task_navigation_mode: taskNavigationMode,
      })
      .select()

    if (error) {
      toast.error(getUserErrorMessage(error, 'Не удалось создать квест.'))
    } else {
      toast.success('Квест создан!')
      navigate(`/quests/${data[0].id}/edit`)
    }
    setLoading(false)
  }

  if (loadingOrganizations) {
    return <div className="p-8">Загрузка организации...</div>
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Создать новый квест</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-medium mb-1">Название *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border p-2 rounded-sm"
            required
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border p-2 rounded-sm"
            rows="3"
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Обложка квеста</label>
          <input
            type="url"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            className="w-full border p-2 rounded-sm"
            placeholder="https://example.com/quest-cover.jpg"
          />
          <p className="text-sm text-gray-500 mt-1">
            Укажите прямую HTTPS-ссылку на изображение. Обложка будет показана участнику перед стартом.
          </p>
        </div>

        <div>
          <label className="block font-medium mb-1">
            Как будет описано место каждого задания?
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={locationOptions.includes('gps')}
                onChange={() => toggleLocationOption('gps')}
              />
              📍 GPS-координаты
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={locationOptions.includes('text')}
                onChange={() => toggleLocationOption('text')}
              />
              📝 Текстовое описание
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={locationOptions.includes('image')}
                onChange={() => toggleLocationOption('image')}
              />
              🖼️ Изображение
            </label>
          </div>

          <p className="text-sm text-gray-500 mt-1">
            Выберите хотя бы один вариант.
          </p>
        </div>
        <div>
          <label className="block font-medium mb-1">Как проверять нахождение на месте?</label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={verificationOptions.includes('gps')}
                disabled={!locationOptions.includes('gps')}
                onChange={() => toggleOption('gps')}
              />
              📍 GPS-координаты
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={verificationOptions.includes('code')}
                onChange={() => toggleOption('code')}
              />
              🔑 Код доступа
            </label>
          </div>
          <p className="text-sm text-gray-500 mt-1">Выберите хотя бы один вариант.</p>
          {verificationOptions.includes('gps') &&
            verificationOptions.includes('code') && (
              <div className="mt-3">
                <label className="block font-medium mb-1">
                  Сколько условий должен выполнить участник?
                </label>
                <select
                  value={verificationMatchPolicy}
                  onChange={event =>
                    setVerificationMatchPolicy(event.target.value)
                  }
                  className="w-full border p-2 rounded-sm"
                >
                  <option value="all">Оба условия: GPS и код</option>
                  <option value="any">Хотя бы одно: GPS или код</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  «Хотя бы одно» позволяет открыть задание по коду, если GPS
                  недоступен или работает нестабильно.
                </p>
              </div>
            )}
        </div>

        <div>
          <label className="block font-medium mb-1">
            Порядок прохождения заданий
          </label>
          <select
            value={taskNavigationMode}
            onChange={event => setTaskNavigationMode(event.target.value)}
            className="w-full border p-2 rounded-sm"
          >
            <option value="sequential">
              Последовательно — следующее задание открывается после текущего
            </option>
            <option value="free">
              Произвольно — участник выбирает доступное задание
            </option>
          </select>
          <p className="text-sm text-gray-500 mt-1">
            В последовательном режиме будущие задания не будут показаны до их открытия.
          </p>
        </div>

        <div>
          <div>
            <label className="block font-medium mb-1">
              Режим проверки
            </label>
            <select
              value={verificationMode}
              onChange={event =>
                setVerificationMode(event.target.value)
              }
              className="w-full border p-2 rounded-sm"
            >
              <option value="online">
                Online — всегда серверная проверка
              </option>
              <option value="hybrid">
                Hybrid — предварительная локальная проверка
              </option>
              <option value="secure_online">
                Secure online — без verifier на клиенте
              </option>
            </select>
            <p className="text-sm text-gray-500 mt-1">
              Сервер всегда выполняет окончательную проверку.
              Hybrid сохраняет на клиенте только PBKDF2 verifier.
            </p>
          </div>

          <div>
            <label className="block font-medium mb-1">
              Поведение без интернета
            </label>
            <select
              value={offlineProgressPolicy}
              onChange={event =>
                setOfflineProgressPolicy(event.target.value)
              }
              className="w-full border p-2 rounded-sm"
            >
              <option value="allow_pending">
                Разрешить pending — проверить после синхронизации
              </option>
              <option value="block">
                Блокировать прохождение без интернета
              </option>
            </select>
          </div>
          <label className="block font-medium mb-1">Лимит попыток на ответ</label>
          <input
            type="number"
            min="0"
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            className="w-full border p-2 rounded-sm"
          />
          <p className="text-sm text-gray-500 mt-1">0 — неограниченно. Если указано число, то при исчерпании попыток задание засчитывается как невыполненное.</p>
          <label className="block font-medium mb-1 mt-4">Лимит прохождений квеста участником</label>
          <input
            type="number"
            min="0"
            value={maxQuestAttempts}
            onChange={(e) => setMaxQuestAttempts(e.target.value)}
            className="w-full border p-2 rounded-sm"
          />
          <p className="text-sm text-gray-500 mt-1">
            0 — неограниченно. Учитываются завершённые успешные и неуспешные прохождения.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            id="isPublic"
          />
          <label htmlFor="isPublic">
            <span className="block">Доступ без приглашения</span>
            <span className="block text-sm font-normal text-gray-500">
              Если выключено, участнику потребуется приглашение, ссылка или код доступа.
            </span>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !currentOrganization}
            className="bg-green-500 text-white px-4 py-2 rounded-sm hover:bg-green-600"
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/quests')}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-sm hover:bg-gray-400"
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  )
}
