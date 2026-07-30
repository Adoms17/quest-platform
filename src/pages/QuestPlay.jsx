import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

// Фикс иконок Leaflet
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

  const [questAttemptId, setQuestAttemptId] = useState(null)
  const [totalTasks, setTotalTasks] = useState(0)
  const [completedTasks, setCompletedTasks] = useState(0)
  const [failedTasks, setFailedTasks] = useState(0)
  const [totalAttempts, setTotalAttempts] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const [startTime, setStartTime] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const [locationVerified, setLocationVerified] = useState(false)
  const [codeVerified, setCodeVerified] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [isLocationPhase, setIsLocationPhase] = useState(true)
  const [selectedOption, setSelectedOption] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [taskCompleted, setTaskCompleted] = useState(false)
  const [taskFailed, setTaskFailed] = useState(false)
  const [taskAttemptsUsed, setTaskAttemptsUsed] = useState(0)
  const [taskStartTime, setTaskStartTime] = useState(null)
  const [taskAttemptId, setTaskAttemptId] = useState(null)
  const [finished, setFinished] = useState(false)

  const currentTask = tasks[currentTaskIndex] || null
  const isLastTask = currentTaskIndex === tasks.length - 1
  const maxAttempts = quest?.max_attempts || 0

  // 1. Загрузка квеста и создание quest_attempt
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
        setTotalTasks(tasksData.length)

        const { data: attemptData, error: attemptError } = await supabase
          .from('quest_attempts')
          .insert({
            quest_id: id,
            user_id: session.user.id,
            total_tasks: tasksData.length,
          })
          .select()
        if (attemptError) throw attemptError
        setQuestAttemptId(attemptData[0].id)
        setStartTime(Date.now())
        setElapsedSeconds(0)
      } catch (err) {
        setError(err.message)
        toast.error('Ошибка загрузки: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchQuestAndTasks()
  }, [id, session])

  // 2. Таймер
  useEffect(() => {
    if (!startTime || finished) return
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime, finished])

  // 3. Инициализация задания (сброс состояний и создание task_attempt)
  useEffect(() => {
    if (!currentTask || !questAttemptId) return

    const initTask = async () => {
      // Сброс
      setLocationVerified(false)
      setCodeVerified(false)
      setCodeInput('')
      setSelectedOption('')
      setAnswerInput('')
      setTaskCompleted(false)
      setTaskFailed(false)
      setTaskAttemptsUsed(0)
      setIsLocationPhase(true)
      setTaskStartTime(Date.now())

      // Создаём task_attempt
      try {
        const { data, error } = await supabase
          .from('task_attempts')
          .insert({
            quest_attempt_id: questAttemptId,
            task_id: currentTask.id,
            opened: false,
            attempts_used: 0,
            completed: false,
            failed: false,
            time_spent: 0,
          })
          .select()
        if (error) throw error
        setTaskAttemptId(data[0].id)
      } catch (err) {
        toast.error('Ошибка создания записи задания: ' + err.message)
      }
    }

    initTask()
  }, [currentTaskIndex, currentTask, questAttemptId])

  // 4. Автооткрытие задания при успешной проверке места
  useEffect(() => {
    if (isLocationPhase && taskAttemptId) {
      tryOpenTask()
    }
  }, [locationVerified, codeVerified, isLocationPhase, taskAttemptId])

  function tryOpenTask() {
    const opts = quest?.verification_options || ['gps']
    let allVerified = true
    if (opts.includes('gps') && !locationVerified) allVerified = false
    if (opts.includes('code') && !codeVerified) allVerified = false
    if (allVerified && isLocationPhase && taskAttemptId) {
      setIsLocationPhase(false)
      supabase
        .from('task_attempts')
        .update({ opened: true })
        .eq('id', taskAttemptId)
        .then(({ error }) => {
          if (error) console.error('Ошибка обновления opened:', error)
        })
      toast.success('🔓 Задание открыто!')
    }
  }

  // 5. Проверка GPS
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
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  // 6. Проверка кода
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

  // 7. Проверка правильности ответа
  function isAnswerCorrect() {
    const correct = currentTask.correct_answer?.trim()?.toLowerCase() || ''
    if (!correct) return true
    if (currentTask.options && Array.isArray(currentTask.options) && currentTask.options.length > 0) {
      return selectedOption.trim().toLowerCase() === correct
    } else {
      return answerInput.trim().toLowerCase() === correct
    }
  }

  // 8. Завершение задания (с обязательным ответом)
  async function completeTask() {
    if (taskCompleted || taskFailed) return

    const hasAnswer = currentTask.correct_answer && currentTask.correct_answer.trim() !== ''
    if (hasAnswer) {
      // Проверяем, что ответ выбран/введён
      let answerProvided = false
      if (currentTask.options && Array.isArray(currentTask.options) && currentTask.options.length > 0) {
        answerProvided = selectedOption.trim() !== ''
      } else {
        answerProvided = answerInput.trim() !== ''
      }
      if (!answerProvided) {
        toast.error('Пожалуйста, выберите вариант или введите ответ перед завершением')
        return
      }

      // Увеличиваем счётчик попыток
      const newAttempts = taskAttemptsUsed + 1
      setTaskAttemptsUsed(newAttempts)
      await supabase
        .from('task_attempts')
        .update({ attempts_used: newAttempts })
        .eq('id', taskAttemptId)

      // Проверяем правильность
      if (isAnswerCorrect()) {
        toast.success('✅ Правильный ответ!')
        await finishTask(true)
      } else {
        if (maxAttempts > 0 && newAttempts >= maxAttempts) {
          toast.error(`❌ Исчерпаны все ${maxAttempts} попыток. Задание не засчитано.`)
          await finishTask(false)
        } else {
          toast.error('❌ Неправильный ответ, попробуйте ещё раз')
        }
      }
    } else {
      // Если ответа нет – просто завершаем
      await finishTask(true)
    }
  }

  // 9. Финализация задания
  async function finishTask(success) {
    const timeSpent = Math.floor((Date.now() - taskStartTime) / 1000)

    // Обновляем task_attempts
    await supabase
      .from('task_attempts')
      .update({
        completed: success,
        failed: !success,
        time_spent: timeSpent,
      })
      .eq('id', taskAttemptId)

    // Обновляем статистику quest_attempt
    let newCompleted = completedTasks
    let newFailed = failedTasks
    if (success) newCompleted++
    else newFailed++
    setCompletedTasks(newCompleted)
    setFailedTasks(newFailed)
    setTotalTime(totalTime + timeSpent)
    setTotalAttempts(totalAttempts + taskAttemptsUsed + 1)

    if (success) setTaskCompleted(true)
    else setTaskFailed(true)

    await supabase
      .from('quest_attempts')
      .update({
        completed_tasks: newCompleted,
        failed_tasks: newFailed,
        total_attempts: totalAttempts + taskAttemptsUsed + 1,
        total_time: totalTime + timeSpent,
        percent_success: totalTasks > 0 ? (newCompleted / totalTasks) * 100 : 0,
      })
      .eq('id', questAttemptId)

    if (isLastTask) {
      await supabase
        .from('quest_attempts')
        .update({ finished_at: new Date().toISOString() })
        .eq('id', questAttemptId)
      setFinished(true)
    } else {
      setTimeout(() => {
        setCurrentTaskIndex(prev => prev + 1)
      }, 500)
    }
  }

  // 10. Определение типа медиа
  function getMediaType(url) {
    if (!url) return null
    const ext = url.split('.').pop().toLowerCase()
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'aac'].includes(ext)) return 'audio'
    return 'image'
  }

  // ========== Рендеринг ==========
  if (loading) return <Loader text="Загрузка квеста..." />
  if (error) return <div className="p-8 text-red-500">Ошибка: {error}</div>
  if (!quest || tasks.length === 0) {
    return <div className="p-8">В этом квесте пока нет заданий</div>
  }
  if (finished) {
    const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 p-8">
        <h1 className="text-4xl font-bold text-green-600">🏁 Квест завершён!</h1>
        <p className="text-xl mt-4">Вы прошли {completedTasks} из {totalTasks} заданий</p>
        <p className="text-lg mt-2">✅ Успешно: {completedTasks} | ❌ Неуспешно: {failedTasks}</p>
        <p className="text-lg">⏱️ Время: {elapsedSeconds} секунд</p>
        <p className="text-lg">🎯 Процент успеха: {percent}%</p>
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
                  onChange={(e) => setCodeInput(e.target.value)}
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
                    onChange={(e) => setAnswerInput(e.target.value)}
                    disabled={taskCompleted || taskFailed}
                    className="w-full border p-2 rounded"
                  />
                )}
                {maxAttempts > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    Попыток: {taskAttemptsUsed} / {maxAttempts}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={completeTask}
              disabled={taskCompleted || taskFailed}
              className={`w-full py-3 rounded text-white ${
                taskCompleted ? 'bg-green-500' :
                taskFailed ? 'bg-red-500' :
                'bg-green-500 hover:bg-green-600'
              }`}
            >
              {taskCompleted ? '✅ Задание выполнено' :
               taskFailed ? '❌ Попытки исчерпаны' :
               'Завершить задание'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}