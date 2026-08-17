import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'
import {
  getQuestFromDB,
  saveQuestToDB,
  upsertPendingResult,
  getActiveLocalQuestAttempt,
  saveQuestAttempt,
  finishQuestAttempt,
  getQuestAttempt, // <-- добавить
} from '../services/db'
import { syncPendingResultsWithRetry } from '../services/sync'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

export default function QuestPlay({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const isOnlineRef = useRef(navigator.onLine)

  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [, setIsOnline] = useState(navigator.onLine)

  const [questAttemptId, setQuestAttemptId] = useState(null)
  const [totalTasks, setTotalTasks] = useState(0)
  const [completedTasks, setCompletedTasks] = useState(0)
  const [failedTasks, setFailedTasks] = useState(0)
  const [totalAttempts, setTotalAttempts] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  const [startTime, setStartTime] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [finished, setFinished] = useState(false)
  const [initAttemptDone, setInitAttemptDone] = useState(false)
  const [taskAttemptsMap, setTaskAttemptsMap] = useState({})

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

  const [isAvailable, setIsAvailable] = useState(false)
  const [availabilityMessage, setAvailabilityMessage] = useState('')
  const [timeUntilStart, setTimeUntilStart] = useState(null)

  const currentTask = tasks[currentTaskIndex] || null
  const maxAttempts = quest?.max_attempts || 0

  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  // ----- Онлайн/офлайн -----
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      isOnlineRef.current = true
      if (session) {
        syncPendingResultsWithRetry(session).catch(err => console.warn('Синхронизация не удалась:', err))
      }
    }
    const handleOffline = () => {
      setIsOnline(false)
      isOnlineRef.current = false
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [session]) // <-- добавили session в зависимости

  // ----- Загрузка квеста -----
  useEffect(() => {
    async function loadQuest() {
      setLoading(true)
      try {
        let questData, tasksData
        const localQuest = await getQuestFromDB(id)
        if (localQuest) {
          questData = localQuest
          tasksData = localQuest.tasks || []
          if (navigator.onLine) {
            fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/quests?id=eq.${id}`, {
              headers: {
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${session.access_token}`,
              }
            })
              .then(res => res.json())
              .then(async (data) => {
                if (data.length > 0) {
                  const { data: tasksRemote } = await supabase
                    .from('tasks')
                    .select('*')
                    .eq('quest_id', id)
                    .order('order_index')
                  if (tasksRemote) {
                    await saveQuestToDB(data[0], tasksRemote)
                  }
                }
              })
              .catch(err => console.warn('Фоновое обновление не удалось', err))
          }
        } else {
          const { data: qData, error: qErr } = await supabase
            .from('quests')
            .select('*')
            .eq('id', id)
            .single()
          if (qErr) throw new Error('Квест не найден')
          questData = qData
          const { data: tData, error: tErr } = await supabase
            .from('tasks')
            .select('*')
            .eq('quest_id', id)
            .order('order_index')
          if (tErr) throw tErr
          tasksData = tData || []
          if (navigator.onLine) {
            try {
              await saveQuestToDB(questData, tasksData)
            } catch { /* ignore */ }
          }
        }
        setQuest(questData)
        setTasks(tasksData)
        setTotalTasks(tasksData.length)
      } catch (err) {
        setError(err.message)
        toast.error('Ошибка загрузки: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    loadQuest()
  }, [id, session])

  // ----- Доступность -----
  const checkAvailability = useCallback(() => {
    if (!quest) return
    const now = new Date()
    let available = true
    let message = ''
    let timeLeft = null
    if (quest.is_open === false) {
      available = false
      message = `⛔ Квест "${quest.title}" закрыт организатором`
    }
    if (available && quest.end_at) {
      const end = new Date(quest.end_at)
      if (end < now) {
        available = false
        message = `⏰ Квест "${quest.title}" был закрыт ${end.toLocaleString()}`
      }
    }
    if (available && quest.start_at) {
      const start = new Date(quest.start_at)
      if (start > now) {
        available = false
        timeLeft = Math.floor((start - now) / 1000)
        message = `⏳ Квест "${quest.title}" откроется ${start.toLocaleString()} через`
      }
    }
    setIsAvailable(available)
    setAvailabilityMessage(message)
    setTimeUntilStart(timeLeft)
  }, [quest])

  useEffect(() => {
    if (!quest) return
    checkAvailability()
    const interval = setInterval(checkAvailability, 1000)
    return () => clearInterval(interval)
  }, [quest, checkAvailability])

  // ----- Функция поиска следующего незавершённого задания -----
  const findNextTaskIndex = useCallback((map) => {
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const ta = map[task.id]
      if (!ta || (!ta.completed && !ta.failed)) {
        return i
      }
    }
    return -1
  }, [tasks])

  // ----- Загрузка существующих task_attempts -----
  const loadTaskAttempts = useCallback(async (attemptId) => {
    const online = navigator.onLine
    let attempts = []

    if (online) {
      const { data, error } = await supabase
        .from('task_attempts')
        .select('*')
        .eq('quest_attempt_id', attemptId)
      if (!error) attempts = data || []
    } else {
      const { getPendingResults } = await import('../services/db')
      const pending = await getPendingResults()
      attempts = pending.filter(r => r.localQuestAttemptId === attemptId && !r.synced)
    }

    const map = {}
    for (const a of attempts) {
      const taskId = a.task_id || a.taskId
      map[taskId] = {
        id: a.id,
        attemptsUsed: a.attempts_used || a.attemptsUsed || 0,
        completed: a.completed || false,
        failed: a.failed || false,
        opened: a.opened || false,
        timeSpent: a.time_spent || a.timeSpent || 0,
      }
    }

    setTaskAttemptsMap(map)

    // Вычисляем статистику
    const completed = tasks.filter(t => map[t.id]?.completed).length
    const failed = tasks.filter(t => map[t.id]?.failed).length
    setCompletedTasks(completed)
    setFailedTasks(failed)

    const nextIndex = findNextTaskIndex(map)
    if (nextIndex === -1) {
      setFinished(true)
    } else {
      setCurrentTaskIndex(nextIndex)
    }
  }, [tasks, findNextTaskIndex])

  // ----- Инициализация попытки (исправленная офлайн-логика) -----
  const initializeAttempt = useCallback(async () => {
    if (!isAvailable || !quest || tasks.length === 0 || initAttemptDone) return

    const userId = session?.user?.id
    if (!userId) {
      toast.error('Пользователь не авторизован')
      return
    }

    const online = navigator.onLine
    let attemptId = null

    if (online) {
      // Онлайн-режим – всегда используем серверный ID
      const { data: existing, error: findError } = await supabase
        .from('quest_attempts')
        .select('id, completed_tasks, failed_tasks, total_attempts, total_time')
        .eq('quest_id', id)
        .eq('user_id', userId)
        .is('finished_at', null)
        .maybeSingle()

      if (findError) throw findError

      if (existing) {
        attemptId = existing.id
        setCompletedTasks(existing.completed_tasks || 0)
        setFailedTasks(existing.failed_tasks || 0)
        setTotalAttempts(existing.total_attempts || 0)
        setTotalTime(existing.total_time || 0)
        const localId = `local-${Date.now()}`
        await saveQuestAttempt(localId, id, userId, attemptId, true, false)
      } else {
        const { data: newAttempt, error: createError } = await supabase
          .from('quest_attempts')
          .insert({
            quest_id: id,
            user_id: userId,
            total_tasks: tasks.length,
          })
          .select()
          .single()
        if (createError) throw createError
        attemptId = newAttempt.id
        const localId = `local-${Date.now()}`
        await saveQuestAttempt(localId, id, userId, attemptId, true, false)
        setCompletedTasks(0)
        setFailedTasks(0)
        setTotalAttempts(0)
        setTotalTime(0)
      }
      sessionStorage.setItem(`questAttempt_${id}`, attemptId)
    } else {
      // Офлайн-режим
      const storageKey = `questAttempt_${id}`
      let stored = sessionStorage.getItem(storageKey)
      let localAttempt = null

      if (stored) {
        // Проверяем, не завершена ли эта попытка
        const existingAttempt = await getQuestAttempt(stored)
        if (existingAttempt && !existingAttempt.finished) {
          attemptId = stored
        } else {
          // Попытка завершена или не найдена – создаём новую
          stored = null
        }
      }

      if (!stored) {
        localAttempt = await getActiveLocalQuestAttempt(id, userId)
        if (!localAttempt || localAttempt.finished) {
          const localId = `local-${Date.now()}`
          await saveQuestAttempt(localId, id, userId, null, false, false)
          localAttempt = await getActiveLocalQuestAttempt(id, userId)
        }
        attemptId = localAttempt.localId
        sessionStorage.setItem(storageKey, attemptId)
      } else {
        attemptId = stored
      }

      setCompletedTasks(0)
      setFailedTasks(0)
      setTotalAttempts(0)
      setTotalTime(0)
    }

    setQuestAttemptId(attemptId)
    await loadTaskAttempts(attemptId)
    setStartTime(Date.now())
    setInitAttemptDone(true)
    toast.success('🔓 Квест открыт!')
  }, [isAvailable, quest, tasks, id, session, initAttemptDone, loadTaskAttempts])

  // Запуск инициализации
  useEffect(() => {
    if (isAvailable && !initAttemptDone) {
      initializeAttempt()
    }
  }, [isAvailable, initAttemptDone, initializeAttempt])

  // Таймер
  useEffect(() => {
    if (!startTime || finished || !initAttemptDone) return
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime, finished, initAttemptDone])

  // ----- Инициализация текущего задания -----
  useEffect(() => {
    if (!currentTask || !questAttemptId || !initAttemptDone || finished) return

    const taskId = currentTask.id
    const existing = taskAttemptsMap[taskId]

    const initTask = async () => {
      // Сбрасываем UI
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
      setManualLat('')
      setManualLng('')
      setShowManualInput(false)

      if (existing) {
        setTaskAttemptId(existing.id)
        setTaskAttemptsUsed(existing.attemptsUsed || 0)
        setTaskCompleted(existing.completed || false)
        setTaskFailed(existing.failed || false)
        if (existing.opened) {
          setIsLocationPhase(false)
        }
        // Если задание уже завершено – переходим
        if (existing.completed || existing.failed) {
          const nextIndex = findNextTaskIndex(taskAttemptsMap)
          if (nextIndex !== -1) {
            setCurrentTaskIndex(nextIndex)
          } else {
            setFinished(true)
          }
          return
        }
      } else {
        // Создаём новую запись
        try {
          let taskAttemptData
          if (navigator.onLine) {
            const { data, error } = await supabase
              .from('task_attempts')
              .insert({
                quest_attempt_id: questAttemptId,
                task_id: taskId,
                opened: false,
                attempts_used: 0,
                completed: false,
                failed: false,
                time_spent: 0,
              })
              .select()
            if (error) throw error
            taskAttemptData = data[0]
          } else {
            taskAttemptData = {
              id: `local-task-${Date.now()}`,
              quest_attempt_id: questAttemptId,
              task_id: taskId,
              opened: false,
              attempts_used: 0,
              completed: false,
              failed: false,
              time_spent: 0,
            }
          }
          const newEntry = {
            id: taskAttemptData.id,
            attemptsUsed: 0,
            completed: false,
            failed: false,
            opened: false,
            timeSpent: 0,
          }
          setTaskAttemptsMap(prev => ({ ...prev, [taskId]: newEntry }))
          setTaskAttemptId(taskAttemptData.id)
        } catch (err) {
          toast.error('Ошибка создания записи задания: ' + err.message)
        }
      }
    }

    initTask()
  }, [currentTaskIndex, currentTask, questAttemptId, initAttemptDone, finished, taskAttemptsMap, tasks, findNextTaskIndex])

  // ----- Логика открытия задания -----
  const tryOpenTask = useCallback(async () => {
    const opts = quest?.verification_options || ['gps']
    let hasGps = false
    let hasCode = false
    if (opts.includes('gps')) hasGps = locationVerified
    if (opts.includes('code')) hasCode = codeVerified

    const isGpsRequired = opts.includes('gps')
    const isCodeRequired = opts.includes('code')

    if (!isGpsRequired && !isCodeRequired) {
      setIsLocationPhase(false)
      if (taskAttemptId) {
        try {
          if (navigator.onLine) {
            await supabase.from('task_attempts').update({ opened: true }).eq('id', taskAttemptId)
          } else {
            await upsertPendingResult(quest.id, currentTask.id, questAttemptId, { opened: true })
          }
          setTaskAttemptsMap(prev => ({
            ...prev,
            [currentTask.id]: { ...prev[currentTask.id], opened: true }
          }))
        } catch (err) { console.error(err) }
      }
      toast.success('🔓 Задание открыто!')
      return
    }

    let canOpen = false
    if (isGpsRequired && hasGps) canOpen = true
    if (isCodeRequired && hasCode) canOpen = true
    if (isGpsRequired && isCodeRequired && hasGps && hasCode) canOpen = true

    if (canOpen && isLocationPhase && taskAttemptId) {
      setIsLocationPhase(false)
      try {
        if (navigator.onLine) {
          await supabase.from('task_attempts').update({ opened: true }).eq('id', taskAttemptId)
        } else {
          await upsertPendingResult(quest.id, currentTask.id, questAttemptId, { opened: true })
        }
        setTaskAttemptsMap(prev => ({
          ...prev,
          [currentTask.id]: { ...prev[currentTask.id], opened: true }
        }))
        toast.success('🔓 Задание открыто!')
      } catch (err) { console.error(err) }
    }
  }, [quest, locationVerified, codeVerified, isLocationPhase, taskAttemptId, currentTask, questAttemptId])

  useEffect(() => {
    if (isLocationPhase && taskAttemptId && questAttemptId) {
      tryOpenTask()
    }
  }, [locationVerified, codeVerified, isLocationPhase, taskAttemptId, questAttemptId, tryOpenTask])

  // ----- Вспомогательные функции -----
  function checkLocation() {
    if (!navigator.geolocation) {
      toast.error('Ваш браузер не поддерживает геолокацию')
      setShowManualInput(true)
      return
    }
    if (!currentTask.gps_point || !currentTask.gps_point.coordinates) {
      setLocationVerified(true)
      toast.success('✅ Проверка места пройдена автоматически (координаты не заданы)')
      return
    }
    const [lng, lat] = currentTask.gps_point.coordinates
    toast.loading('Определение местоположения...', { id: 'geolocation' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        toast.dismiss('geolocation')
        const userLat = pos.coords.latitude
        const userLng = pos.coords.longitude
        const distance = getDistance(lat, lng, userLat, userLng)
        if (distance <= 50) {
          setLocationVerified(true)
          toast.success(`✅ Вы на месте! Расстояние ${Math.round(distance)} м`)
        } else {
          toast.error(`❌ Вы слишком далеко (${Math.round(distance)} м). Подойдите ближе`)
          setShowManualInput(true)
        }
      },
      (err) => {
        toast.dismiss('geolocation')
        console.error('❌ Ошибка геолокации:', err)
        toast.error('Не удалось определить местоположение: ' + err.message)
        setShowManualInput(true)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  function checkManualLocation() {
    const latNum = parseFloat(manualLat)
    const lngNum = parseFloat(manualLng)
    if (isNaN(latNum) || isNaN(lngNum)) {
      toast.error('Введите корректные координаты (числа)')
      return
    }
    if (!currentTask.gps_point || !currentTask.gps_point.coordinates) {
      setLocationVerified(true)
      toast.success('✅ Проверка места пройдена')
      return
    }
    const [taskLng, taskLat] = currentTask.gps_point.coordinates
    const distance = getDistance(taskLat, taskLng, latNum, lngNum)
    if (distance <= 50) {
      setLocationVerified(true)
      toast.success(`✅ Вы на месте! Расстояние ${Math.round(distance)} м`)
      setShowManualInput(false)
    } else {
      toast.error(`❌ Вы слишком далеко (${Math.round(distance)} м). Подойдите ближе`)
    }
  }

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
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

  // ----- Завершение задания -----
  async function completeTask() {
    if (taskCompleted || taskFailed) return
    const hasAnswer = currentTask.correct_answer && currentTask.correct_answer.trim() !== ''
    if (hasAnswer) {
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

      const newAttempts = taskAttemptsUsed + 1
      setTaskAttemptsUsed(newAttempts)

      if (navigator.onLine) {
        await supabase.from('task_attempts').update({ attempts_used: newAttempts }).eq('id', taskAttemptId)
      } else {
        await upsertPendingResult(quest.id, currentTask.id, questAttemptId, {
          opened: true,
          attemptsUsed: newAttempts,
          completed: false,
          failed: false,
          timeSpent: 0,
        })
      }

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
      await finishTask(true)
    }
  }

  async function finishTask(success) {
    const timeSpent = Math.floor((Date.now() - taskStartTime) / 1000)

    if (navigator.onLine) {
      await supabase
        .from('task_attempts')
        .update({
          completed: success,
          failed: !success,
          time_spent: timeSpent,
        })
        .eq('id', taskAttemptId)
    } else {
      await upsertPendingResult(quest.id, currentTask.id, questAttemptId, {
        opened: true,
        attemptsUsed: taskAttemptsUsed + 1,
        completed: success,
        failed: !success,
        timeSpent: timeSpent,
      })
    }

    setTaskAttemptsMap(prev => {
      const newMap = {
        ...prev,
        [currentTask.id]: {
          ...prev[currentTask.id],
          completed: success,
          failed: !success,
          attemptsUsed: taskAttemptsUsed + 1,
          timeSpent: timeSpent,
        }
      }

      // Пересчитываем статистику
      const completed = tasks.filter(t => newMap[t.id]?.completed).length
      const failed = tasks.filter(t => newMap[t.id]?.failed).length
      setCompletedTasks(completed)
      setFailedTasks(failed)
      setTotalTime(totalTime + timeSpent)
      setTotalAttempts(totalAttempts + taskAttemptsUsed + 1)

      // Обновляем quest_attempts (онлайн)
      if (navigator.onLine) {
        supabase
          .from('quest_attempts')
          .update({
            completed_tasks: completed,
            failed_tasks: failed,
            total_attempts: totalAttempts + taskAttemptsUsed + 1,
            total_time: totalTime + timeSpent,
            percent_success: totalTasks > 0 ? (completed / totalTasks) * 100 : 0,
          })
          .eq('id', questAttemptId)
          .then()
      }

      // Находим следующий незавершённый индекс
      const nextIndex = findNextTaskIndex(newMap)
      if (nextIndex === -1) {
        if (navigator.onLine) {
          supabase
            .from('quest_attempts')
            .update({ finished_at: new Date().toISOString() })
            .eq('id', questAttemptId)
            .then()
        } else {
          finishQuestAttempt(questAttemptId)
        }
        setFinished(true)
      } else {
        setCurrentTaskIndex(nextIndex)
      }

      return newMap
    })
  }

  // ----- Форматирование времени и медиа -----
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  function getMediaType(url) {
    if (!url) return null
    const ext = url.split('.').pop().toLowerCase()
    if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image'
    if (['mp4','webm','ogg'].includes(ext)) return 'video'
    if (['mp3','wav','aac'].includes(ext)) return 'audio'
    return 'image'
  }

  const handleExit = () => {
    sessionStorage.removeItem(`questAttempt_${id}`)
    navigate('/quests')
  }

  // ----- Рендеры -----
  if (loading) return <Loader text="Загрузка квеста..." />
  if (error) return <div className="p-8 text-red-500">Ошибка: {error}</div>
  if (!quest || tasks.length === 0) {
    return <div className="p-8">В этом квесте пока нет заданий</div>
  }
  if (!isAvailable) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-50">
        <div className="bg-white p-8 rounded shadow max-w-md text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">⛔ Квест недоступен</h2>
          <p className="text-gray-700">{availabilityMessage}</p>
          {timeUntilStart !== null && timeUntilStart > 0 && (
            <div className="mt-4 text-3xl font-mono font-bold text-blue-600">
              {formatTime(timeUntilStart)}
            </div>
          )}
          <button onClick={() => navigate('/')} className="mt-6 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
            На главную
          </button>
        </div>
      </div>
    )
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
        <button onClick={() => navigate('/')} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded hover:bg-blue-600">
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
          onClick={handleExit}
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
            {currentTask.location_text && <p className="text-sm text-gray-700 mt-1">{currentTask.location_text}</p>}
            {currentTask.location_image_url && (
              <img src={currentTask.location_image_url} alt="Место" className="mt-2 max-w-full h-auto rounded max-h-40 object-cover" />
            )}
          </div>
        )}
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
                {!locationVerified && showManualInput && (
                  <div className="mt-2 p-3 border rounded bg-yellow-50">
                    <p className="text-sm text-gray-700 mb-2">Не удалось определить местоположение. Введите координаты вручную:</p>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Широта (например, 44.6058)"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                        className="border p-1 rounded w-1/2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Долгота (например, 33.5891)"
                        value={manualLng}
                        onChange={(e) => setManualLng(e.target.value)}
                        className="border p-1 rounded w-1/2 text-sm"
                      />
                    </div>
                    <button
                      onClick={checkManualLocation}
                      className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
                    >
                      Проверить по координатам
                    </button>
                    <button
                      onClick={() => setShowManualInput(false)}
                      className="ml-2 bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-400"
                    >
                      Отмена
                    </button>
                  </div>
                )}
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
                  <p className="text-sm text-gray-500 mt-1">Попыток: {taskAttemptsUsed} / {maxAttempts}</p>
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