import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import MapPicker from '../components/MapPicker'
import Loader from '../components/Loader'

export default function QuestPlay({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Состояния для текущего задания
  const [locationVerified, setLocationVerified] = useState(false)
  const [codeVerified, setCodeVerified] = useState(false)
  const [answerInput, setAnswerInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [taskCompleted, setTaskCompleted] = useState(false)
  const [startTime, setStartTime] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [finished, setFinished] = useState(false)

  // Загружаем квест и задания
  useEffect(() => {
    async function fetchQuestAndTasks() {
      setLoading(true)
      try {
        // 1. Загружаем квест
        const { data: questData, error: questError } = await supabase
          .from('quests')
          .select('*')
          .eq('id', id)
          .single()
        if (questError) throw new Error('Квест не найден')
        setQuest(questData)

        // 2. Загружаем задания
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
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchQuestAndTasks()
  }, [id])

  // Таймер
  useEffect(() => {
    if (!startTime || finished) return
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime, finished])

  const currentTask = tasks[currentTaskIndex] || null
  const isLastTask = currentTaskIndex === tasks.length - 1

  // Сброс состояний при смене задания
  useEffect(() => {
    setLocationVerified(false)
    setCodeVerified(false)
    setAnswerInput('')
    setCodeInput('')
    setTaskCompleted(false)
  }, [currentTaskIndex])

  // Проверка GPS
  function checkLocation() {
    if (!navigator.geolocation) {
      alert('Ваш браузер не поддерживает геолокацию')
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
          alert(`✅ Вы на месте! Расстояние ${Math.round(distance)} м`)
        } else {
          alert(`❌ Вы слишком далеко (${Math.round(distance)} м). Подойдите ближе (в радиусе 50 м)`)
        }
      },
      (err) => {
        alert('Не удалось определить местоположение: ' + err.message)
      },
      { enableHighAccuracy: true }
    )
  }

  // Расчёт расстояния (формула гаверсинуса)
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000 // радиус Земли в метрах
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Проверка кода
  function checkCode() {
    if (!currentTask.static_code) {
      setCodeVerified(true)
      return
    }
    if (codeInput.trim().toUpperCase() === currentTask.static_code.trim().toUpperCase()) {
      setCodeVerified(true)
      alert('✅ Код верен!')
    } else {
      alert('❌ Неверный код, попробуйте ещё раз')
    }
  }

  // Проверка ответа
  function checkAnswer() {
    if (!currentTask.correct_answer) {
      // Если ответ не задан, засчитываем автоматически
      return true
    }
    if (answerInput.trim().toLowerCase() === currentTask.correct_answer.trim().toLowerCase()) {
      alert('✅ Правильный ответ!')
      return true
    } else {
      alert('❌ Неправильный ответ, попробуйте ещё раз')
      return false
    }
  }

  // Завершение текущего задания
  async function completeTask() {
    if (taskCompleted) return

    // Проверяем, что все условия выполнены
    const hasGps = currentTask.gps_point && currentTask.gps_point.coordinates
    const hasCode = currentTask.static_code && currentTask.static_code.trim() !== ''
    const hasAnswer = currentTask.correct_answer && currentTask.correct_answer.trim() !== ''

    if (hasGps && !locationVerified) {
      alert('Сначала подтвердите нахождение на месте')
      return
    }
    if (hasCode && !codeVerified) {
      alert('Сначала введите правильный код')
      return
    }
    if (hasAnswer) {
      const ok = checkAnswer()
      if (!ok) return
    }

    // Записываем результат в БД
    try {
      const timeSpent = elapsedSeconds // примерное время от начала квеста
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

      // Если это последнее задание — финиш
      if (isLastTask) {
        setFinished(true)
      } else {
        // Переход к следующему
        setTimeout(() => {
          setCurrentTaskIndex(prev => prev + 1)
        }, 500)
      }
    } catch (err) {
      alert('Ошибка сохранения: ' + err.message)
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
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{quest.title}</h1>
        <p className="text-gray-600">
          Задание {currentTaskIndex + 1} из {tasks.length}
        </p>
        <p className="text-sm text-gray-500">⏱️ {elapsedSeconds} сек</p>
      </div>

      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-2">{currentTask.title}</h2>
        <p className="text-gray-700 mb-4">{currentTask.description}</p>
        {currentTask.hint && (
          <details className="mb-4">
            <summary className="text-blue-500 cursor-pointer">Подсказка</summary>
            <p className="mt-2 text-gray-600 bg-gray-100 p-2 rounded">{currentTask.hint}</p>
          </details>
        )}

        {/* GPS */}
        {currentTask.gps_point && currentTask.gps_point.coordinates && (
          <div className="mb-4">
            <button
              onClick={checkLocation}
              disabled={locationVerified}
              className={`px-4 py-2 rounded ${locationVerified ? 'bg-green-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            >
              {locationVerified ? '✅ На месте' : '📍 Я на месте'}
            </button>
            <p className="text-xs text-gray-500 mt-1">
              Координаты: {currentTask.gps_point.coordinates[1].toFixed(6)}, {currentTask.gps_point.coordinates[0].toFixed(6)}
            </p>
          </div>
        )}

        {/* Код */}
        {currentTask.static_code && currentTask.static_code.trim() !== '' && (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="text"
              placeholder="Введите код"
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

        {/* Ответ на вопрос */}
        {currentTask.correct_answer && currentTask.correct_answer.trim() !== '' && (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="text"
              placeholder="Ваш ответ"
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              disabled={taskCompleted}
              className="border p-2 rounded flex-1"
            />
          </div>
        )}

        {/* Кнопка завершения задания */}
        <button
          onClick={completeTask}
          disabled={taskCompleted}
          className={`w-full py-3 rounded text-white ${taskCompleted ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'}`}
        >
          {taskCompleted ? '✅ Задание выполнено' : 'Завершить задание'}
        </button>
      </div>
    </div>
  )
}