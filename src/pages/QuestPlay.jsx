import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

export default function QuestPlay({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [locationVerified, setLocationVerified] = useState(false)
  const [codeVerified, setCodeVerified] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [isLocationPhase, setIsLocationPhase] = useState(true)

  const [selectedOption, setSelectedOption] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [taskCompleted, setTaskCompleted] = useState(false)
  const [startTime, setStartTime] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [finished, setFinished] = useState(false)

  const currentTask = tasks[currentTaskIndex] || null
  const isLastTask = currentTaskIndex === tasks.length - 1

  useEffect(() => {
    async function fetchQuestAndTasks() {
      setLoading(true)
      try {
        const { data: questData, error: questError } = await supabase
          .from('quests')
          .select('*')
          .eq('id', id)
          .single()
        if (questError) throw new Error('Квест не найден')
        setQuest(questData)

        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('*')
          .eq('quest_id', id)
          .order('order_index', { ascending: true })
        if (tasksError) throw tasksError
        setTasks(tasksData || [])
        setStartTime(Date.now())
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchQuestAndTasks()
  }, [id])

  useEffect(() => {
    if (!startTime || finished) return
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime, finished])

  useEffect(() => {
    setLocationVerified(false)
    setCodeVerified(false)
    setCodeInput('')
    setSelectedOption('')
    setAnswerInput('')
    setTaskCompleted(false)
    setIsLocationPhase(true)
  }, [currentTaskIndex])

  // ✅ Основное исправление: при изменении состояний проверки пытаемся открыть задание
  useEffect(() => {
    if (isLocationPhase) {
      tryOpenTask()
    }
  }, [locationVerified, codeVerified, isLocationPhase])

  function tryOpenTask() {
    const opts = quest?.verification_options || ['gps']
    let allVerified = true
    if (opts.includes('gps') && !locationVerified) allVerified = false
    if (opts.includes('code') && !codeVerified) allVerified = false
    if (allVerified && isLocationPhase) {
      setIsLocationPhase(false)
      toast.success('🔓 Задание открыто!')
    }
  }

  function checkLocation() {
    if (!navigator.geolocation) {
      toast.error('Ваш браузер не поддерживает геолокацию')
      return
    }
    if (!currentTask.gps_point || !currentTask.gps_point.coordinates) {
      setLocationVerified(true)
      return
    }
    const [lng, lat] = currentTask.gps_point.coordinates
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = pos.coords.latitude
        const userLng = pos.coords.longitude
        const distance = getDistance(lat, lng, userLat, userLng)
        if (distance <= 50) {
          setLocationVerified(true)
          toast.success(`✅ Вы на месте! Расстояние ${Math.round(distance)} м`)
        } else {
          toast.error(`❌ Вы слишком далеко (${Math.round(distance)} м). Подойдите ближе`)
        }
      },
      (err) => {
        toast.error('Не удалось определить местоположение: ' + err.message)
      },
      { enableHighAccuracy: true }
    )
  }

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  function checkCode() {
    if (!currentTask.static_code) {
      setCodeVerified(true)
      return
    }
    if (codeInput.trim().toUpperCase() === currentTask.static_code.trim().toUpperCase()) {
      setCodeVerified(true)
      toast.success('✅ Код верен!')
    } else {
      toast.error('❌ Неверный код')
    }
  }

  function isAnswerCorrect() {
    const correct = currentTask.correct_answer?.trim()?.toLowerCase() || ''
    if (!correct) return true
    if (currentTask.options && Array.isArray(currentTask.options) && currentTask.options.length > 0) {
      return selectedOption.trim().toLowerCase() === correct
    } else {
      return answerInput.trim().toLowerCase() === correct
    }
  }

  async function completeTask() {
    if (taskCompleted) return
    const hasAnswer = currentTask.correct_answer && currentTask.correct_answer.trim() !== ''
    if (hasAnswer) {
      if (!isAnswerCorrect()) {
        toast.error('❌ Неправильный ответ, попробуйте ещё раз')
        return
      } else {
        toast.success('✅ Правильный ответ!')
      }
    }
    try {
      const timeSpent = elapsedSeconds
      const { error } = await supabase
        .from('attempts')
        .insert({
          participant_id: session.user.id,
          task_id: currentTask.id,
          is_completed: true,
          time_spent: timeSpent,
          submitted_at: new Date().toISOString(),
        })
      if (error) throw error
      setTaskCompleted(true)
      if (isLastTask) {
        setFinished(true)
      } else {
        setTimeout(() => setCurrentTaskIndex(prev => prev + 1), 500)
      }
    } catch (err) {
      toast.error('Ошибка сохранения: ' + err.message)
    }
  }

  if (loading) return <Loader text="Загрузка квеста..." />
  if (error) return <div className="p-8 text-red-500">Ошибка: {error}</div>
  if (!quest || tasks.length === 0) {
    return <div className="p-8">В этом квесте пока нет заданий</div>
  }
  if (finished) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 p-8">
        <h1 className="text-4xl font-bold text-green-600">🎉 Квест завершён!</h1>
        <p className="text-xl mt-4">Вы прошли все {tasks.length} заданий!</p>
        <p className="text-lg mt-2">⏱️ Время: {elapsedSeconds} секунд</p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 bg-blue-500 text-white px-6 py-3 rounded hover:bg-blue-600"
        >
          На главную
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{quest.title}</h1>
        <button
          onClick={() => navigate('/quests')}
          className="text-red-500 hover:text-red-700 text-sm border border-red-500 px-3 py-1 rounded hover:bg-red-50"
        >
          ✕ Выйти из квеста
        </button>
      </div>

      <div className="flex justify-between items-center mb-2 text-sm text-gray-600">
        <span>Задание {currentTaskIndex + 1} из {tasks.length}</span>
        <span>⏱️ {elapsedSeconds} сек</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${((currentTaskIndex) / tasks.length) * 100}%` }}
        />
      </div>

      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-2">{currentTask.title}</h2>

        {/* Блок места */}
        {(currentTask.gps_point?.coordinates || currentTask.location_text || currentTask.location_image_url) && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
            <h4 className="font-semibold text-blue-700 mb-1">📍 Место задания</h4>
            {currentTask.gps_point?.coordinates && (
              <>
                <p className="text-sm text-gray-600">
                  Координаты: {currentTask.gps_point.coordinates[1].toFixed(6)}, {currentTask.gps_point.coordinates[0].toFixed(6)}
                </p>
                <div className="h-48 w-full mt-2 rounded overflow-hidden border">
                  <MapContainer
                    center={[currentTask.gps_point.coordinates[1], currentTask.gps_point.coordinates[0]]}
                    zoom={15}
                    scrollWheelZoom={false}
                    dragging={false}
                    zoomControl={false}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[currentTask.gps_point.coordinates[1], currentTask.gps_point.coordinates[0]]} />
                  </MapContainer>
                </div>
              </>
            )}
            {currentTask.location_text && (
              <p className="text-sm text-gray-700 mt-1">{currentTask.location_text}</p>
            )}
            {currentTask.location_image_url && (
              <img
                src={currentTask.location_image_url}
                alt="Место"
                className="mt-2 max-w-full h-auto rounded max-h-40 object-cover"
              />
            )}
          </div>
        )}

        {/* Фаза проверки места */}
        {isLocationPhase && (
          <div className="border-t border-blue-200 pt-4 mt-4">
            <p className="text-gray-700 mb-3">Для доступа к заданию необходимо подтвердить нахождение на месте:</p>
            {quest.verification_options.includes('gps') && (
              <div className="mb-3">
                <button
                  onClick={checkLocation}
                  disabled={locationVerified}
                  className={`px-4 py-2 rounded ${locationVerified ? 'bg-green-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                >
                  {locationVerified ? '✅ На месте' : '📍 Я на месте'}
                </button>
              </div>
            )}
            {quest.verification_options.includes('code') && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Введите код доступа"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value)}
                  disabled={codeVerified}
                  className="border p-2 rounded flex-1"
                />
                <button
                  onClick={checkCode}
                  disabled={codeVerified}
                  className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                >
                  {codeVerified ? '✅ Код принят' : 'Проверить код'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Полное задание (открывается после проверки) */}
        {!isLocationPhase && (
          <div className="border-t border-gray-200 pt-4 mt-4">
            {currentTask.description && <p className="text-gray-700 mb-2">{currentTask.description}</p>}
            {currentTask.media_url && (
              <div className="mb-3">
                {getMediaType(currentTask.media_url) === 'image' && (
                  <img src={currentTask.media_url} alt="Медиа" className="max-w-full h-auto rounded" />
                )}
                {getMediaType(currentTask.media_url) === 'video' && (
                  <video controls className="max-w-full h-auto rounded">
                    <source src={currentTask.media_url} type={`video/${currentTask.media_url.split('.').pop()}`} />
                  </video>
                )}
                {getMediaType(currentTask.media_url) === 'audio' && (
                  <audio controls className="w-full">
                    <source src={currentTask.media_url} type={`audio/${currentTask.media_url.split('.').pop()}`} />
                  </audio>
                )}
              </div>
            )}
            {currentTask.hint && (
              <details className="mb-3">
                <summary className="text-blue-500 cursor-pointer">Подсказка</summary>
                <p className="mt-1 text-gray-600 bg-gray-100 p-2 rounded">{currentTask.hint}</p>
              </details>
            )}
            {currentTask.correct_answer && currentTask.correct_answer.trim() !== '' && (
              <div className="mb-3">
                {currentTask.options && Array.isArray(currentTask.options) && currentTask.options.length > 0 ? (
                  <div className="space-y-2">
                    <p className="font-medium">Выберите правильный вариант:</p>
                    {currentTask.options.map((opt, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedOption(opt)}
                        className={`block w-full text-left p-2 border rounded transition ${
                          selectedOption === opt ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Введите ваш ответ"
                    value={answerInput}
                    onChange={e => setAnswerInput(e.target.value)}
                    disabled={taskCompleted}
                    className="w-full border p-2 rounded"
                  />
                )}
              </div>
            )}
            <button
              onClick={completeTask}
              disabled={taskCompleted}
              className={`w-full py-3 rounded text-white ${taskCompleted ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'}`}
            >
              {taskCompleted ? '✅ Задание выполнено' : 'Завершить задание'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function getMediaType(url) {
  if (!url) return null
  const ext = url.split('.').pop().toLowerCase()
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image'
  if (['mp4','webm','ogg'].includes(ext)) return 'video'
  if (['mp3','wav','aac'].includes(ext)) return 'audio'
  return 'image'
}