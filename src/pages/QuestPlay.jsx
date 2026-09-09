import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Loader from '../components/Loader'
import QuestStartScreen from '../components/QuestStartScreen'
import QuestTaskSummary from '../components/QuestTaskSummary'
import TaskLocationMap from '../components/TaskLocationMap'
import ParticipantProfileSelect from '../components/ParticipantProfileSelect'
import toast from 'react-hot-toast'
import {
  getQuestFromDB,
  getQuestPackageMetadata,
  saveQuestToDB,
  getActiveLocalQuestAttempt,
  saveQuestAttempt,
  getQuestAttempt, // <-- добавить
  getPendingResults,
  createClientEventId,
  enqueuePendingEvent,
} from '../services/db'
import {
  loadParticipantTasks,
  loadParticipantQuest,
  loadParticipantQuestSummary,
  loadQuestEntryStatus,
  startServerQuestAttempt,
  submitTaskEvent,
} from '../services/questApi'
import { verifyHybridCandidate } from '../services/hybridVerification'
import {
  getGeolocationErrorMessage,
  usesAnyLocationVerification,
} from '../services/verificationPolicy'
import { isTransportError } from '../services/network'
import { getQuestAccessErrorMessage } from '../services/questAccessErrors'
import { finalizeTrustedQuestAttempt } from '../services/questAttemptLifecycle'
import { getQuestAvailability } from '../services/questAvailability'
import { getAnswerResultMessage } from '../services/questResultPresentation'
import {
  buildQuestTaskSummary,
  countOpenedQuestTasks,
} from '../services/questTaskSummary'
import {
  enableParticipantMode,
  getParticipantModeLock,
  isValidParticipantModePin,
} from '../services/participantMode'

export default function QuestPlay({ session }) {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const participantProfileId = searchParams.get('participant')
  const navigate = useNavigate()
  const isOnlineRef = useRef(navigator.onLine)
  const questLoadKeyRef = useRef(null)
  const attemptInitializationKeyRef = useRef(null)

  const [quest, setQuest] = useState(null)
  const [tasks, setTasks] = useState([])
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [hasStarted, setHasStarted] = useState(false)
  const [showTaskSummary, setShowTaskSummary] = useState(true)
  const [questSummary, setQuestSummary] = useState(null)
  const [offlinePackageStatus, setOfflinePackageStatus] = useState('loading')
  const [offlinePackageMetadata, setOfflinePackageMetadata] = useState(null)
  const [attemptLimitReached, setAttemptLimitReached] = useState(false)
  const [hasExistingAttempt, setHasExistingAttempt] = useState(false)
  const [participantProfiles, setParticipantProfiles] = useState([])
  const [participantModePin, setParticipantModePin] = useState('')
  const [participantModePinConfirmation, setParticipantModePinConfirmation] = useState('')
  const [participantModeError, setParticipantModeError] = useState('')

  const [questAttemptId, setQuestAttemptId] = useState(null)
  const [totalTasks, setTotalTasks] = useState(0)
  const [completedTasks, setCompletedTasks] = useState(0)
  const [failedTasks, setFailedTasks] = useState(0)
  const [, setTotalAttempts] = useState(0)
  const [, setTotalTime] = useState(0)
  const [startTime, setStartTime] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [finished, setFinished] = useState(false)
  const [hasPendingConfirmation, setHasPendingConfirmation] =
  useState(false)
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

  const [availabilityNow, setAvailabilityNow] = useState(() => Date.now())

  const currentTask = tasks[currentTaskIndex] || null
  const progressTasks = useMemo(() => buildQuestTaskSummary({
    tasks,
    taskAttemptsMap,
    navigationMode: quest?.task_navigation_mode || 'sequential',
    serverSummary: questSummary,
  }), [quest?.task_navigation_mode, questSummary, taskAttemptsMap, tasks])
  const openedTaskCount = countOpenedQuestTasks(progressTasks, currentTask?.id)
  const progressTaskCount = tasks.length || totalTasks
  const maxAttempts = quest?.max_attempts || 0
  const selectedParticipantProfile = participantProfiles.find(
    profile => profile.participant_profile_id === participantProfileId
  )
  const existingParticipantMode = getParticipantModeLock()
  const participantModeIsActive = Boolean(
    existingParticipantMode?.actorUserId === session?.user?.id &&
    existingParticipantMode?.participantProfileId === participantProfileId &&
    existingParticipantMode?.questId === id
  )
  const offlineFallbackProfiles = useMemo(() => {
    if (!participantProfileId) return []
    if (participantProfileId === session?.user?.id) {
      return [{
        participant_profile_id: participantProfileId,
        display_name: session.user.user_metadata?.username || session.user.email || 'Мой профиль',
        relationship: 'self',
        supervision_status: 'active',
      }]
    }

    const isLockedProfile = existingParticipantMode?.actorUserId === session?.user?.id &&
      existingParticipantMode?.participantProfileId === participantProfileId &&
      existingParticipantMode?.questId === id
    return [{
      participant_profile_id: participantProfileId,
      display_name: isLockedProfile
        ? existingParticipantMode.participantDisplayName || 'Участник'
        : 'Сохранённый профиль',
      relationship: 'supervised',
      supervision_status: 'active',
    }]
  }, [
    existingParticipantMode?.actorUserId,
    existingParticipantMode?.participantDisplayName,
    existingParticipantMode?.participantProfileId,
    existingParticipantMode?.questId,
    id,
    participantProfileId,
    session?.user?.email,
    session?.user?.id,
    session?.user?.user_metadata?.username,
  ])

  const handleParticipantChange = useCallback((nextParticipantProfileId) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    if (nextParticipantProfileId) {
      nextSearchParams.set('participant', nextParticipantProfileId)
    } else {
      nextSearchParams.delete('participant')
    }
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const handleProfilesLoaded = useCallback(profiles => {
    setParticipantProfiles(profiles)
  }, [])

  const handleStart = async () => {
    if (selectedParticipantProfile?.relationship !== 'self' && !participantModeIsActive) {
      if (!isValidParticipantModePin(participantModePin)) {
        setParticipantModeError('Укажите PIN взрослого из 4–6 цифр.')
        return
      }
      if (participantModePin !== participantModePinConfirmation) {
        setParticipantModeError('PIN и подтверждение не совпадают.')
        return
      }
      await enableParticipantMode({
        actorUserId: session.user.id,
        participantProfileId,
        participantDisplayName: selectedParticipantProfile.display_name,
        questId: id,
        pin: participantModePin,
      })
    }
    setParticipantModeError('')
    setHasStarted(true)
  }

  const [openingTask, setOpeningTask] = useState(false)
  // ----- Онлайн/офлайн -----
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      isOnlineRef.current = true
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
  }, [])

  // ----- Загрузка квеста -----
  useEffect(() => {
    const loadKey = `${id}:${session?.user?.id || 'anonymous'}:${participantProfileId || 'self'}`

    if (questLoadKeyRef.current === loadKey) return
    questLoadKeyRef.current = loadKey

    async function loadQuest() {
      setLoading(true)
      setError(null)
      setHasStarted(false)
      setShowTaskSummary(true)
      setQuestSummary(null)
      setInitAttemptDone(false)
      setFinished(false)
      setQuestAttemptId(null)
      setAttemptLimitReached(false)
      setHasExistingAttempt(false)
      setOfflinePackageStatus('loading')
      setOfflinePackageMetadata(null)

      try {
        let questData
        let tasksData

        async function loadCachedQuest() {
          const localQuest = await getQuestFromDB(id, participantProfileId)

          if (!localQuest) {
            throw new Error('Квест не загружен для работы без интернета')
          }

          setOfflinePackageMetadata(await getQuestPackageMetadata(
            id,
            participantProfileId
          ))
          return {
            questData: localQuest,
            tasksData: localQuest.tasks || [],
          }
        }

        if (isOnlineRef.current) {
          try {
            const entryStatus = await loadQuestEntryStatus(id)
            const entryAvailability = getQuestAvailability(entryStatus)

            if (!entryAvailability.isAvailable) {
              questData = entryStatus
              tasksData = []
              setQuest(questData)
              setTasks(tasksData)
              setTotalTasks(0)
              return
            }

            if (participantProfileId) {
              questData = await loadParticipantQuest(id, participantProfileId)
              tasksData = await loadParticipantTasks(id, participantProfileId)
            } else {
              questData = await loadParticipantQuest(id)
              tasksData = await loadParticipantTasks(id)
            }

            const effectiveParticipantProfileId = participantProfileId || session?.user?.id
            if (effectiveParticipantProfileId) {
              setQuestSummary(await loadParticipantQuestSummary(
                id,
                effectiveParticipantProfileId
              ))
            }

            try {
              const packageMetadata = await saveQuestToDB(
                questData,
                tasksData,
                participantProfileId
              )
              setOfflinePackageMetadata(await getQuestPackageMetadata(
                id,
                participantProfileId
              ) || packageMetadata)
              setOfflinePackageStatus('ready')
            } catch (cacheError) {
              console.warn('Не удалось сохранить квест для offline:', cacheError)
              setOfflinePackageStatus('unavailable')
            }
          } catch (remoteError) {
            if (!isTransportError(remoteError)) throw remoteError

            isOnlineRef.current = false
            setIsOnline(false)

            const cached = await loadCachedQuest()
            questData = cached.questData
            tasksData = cached.tasksData
            setOfflinePackageStatus('ready')
          }
        } else {
          const cached = await loadCachedQuest()
          questData = cached.questData
          tasksData = cached.tasksData
          setOfflinePackageStatus('ready')
        }

        setQuest(questData)
        setTasks(tasksData)
        setTotalTasks(tasksData.length)

        const currentUserId = session?.user?.id
        if (currentUserId) {
          const effectiveParticipantProfileId = participantProfileId || currentUserId
          const localAttempt = await getActiveLocalQuestAttempt(
            id,
            currentUserId,
            effectiveParticipantProfileId
          )
          setHasExistingAttempt(Boolean(localAttempt))
        }
      } catch (err) {
        setError(err.message)
        const accessErrorMessage = getQuestAccessErrorMessage(err.message)
        toast.error(
          accessErrorMessage
            ? 'Нет активного доступа к квесту'
            : 'Не удалось загрузить квест. Попробуйте ещё раз.'
        )
      } finally {
        setLoading(false)
      }
    }

    loadQuest()
  }, [id, session, participantProfileId])

  // ----- Доступность -----
  const { isAvailable, availabilityMessage, timeUntilStart } = useMemo(() => {
    return getQuestAvailability(quest, availabilityNow)
  }, [availabilityNow, quest])

  useEffect(() => {
    if (!quest) return
    const interval = setInterval(() => setAvailabilityNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [quest])

  // ----- Функция поиска следующего незавершённого задания -----
  const findNextTaskIndex = useCallback((map) => {
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const ta = map[task.id]
      if (!ta || (!ta.completed && !ta.failed && !ta.pending)) {
        return i
      }
    }
    return -1
  }, [tasks])

  // ----- Загрузка существующих task_attempts -----
  const userId = session?.user?.id

  const loadTaskAttempts = useCallback(async (attemptId) => {
    const online = isOnlineRef.current
    let attempts = []

    if (online) {
      const { data, error } = await supabase
        .from('task_attempts')
        .select('*')
        .eq('quest_attempt_id', attemptId)
      if (!error) attempts = data || []
    } else {
      const pending = userId
        ? await getPendingResults(userId)
        : []
      attempts = pending.filter(r => r.localQuestAttemptId === attemptId && !r.synced)
    }

    const map = {}

    for (const attempt of attempts) {
      const taskId = attempt.task_id || attempt.taskId
      const current = map[taskId] || {
        id: null,
        attemptsUsed: 0,
        completed: false,
        failed: false,
        opened: false,
        timeSpent: 0,
        pending: false,
        pendingOpen: false,
      }

      if (attempt.eventType === 'open') {
        map[taskId] = {
          ...current,
          opened: true,
          pendingOpen: true,
        }
      } else if (attempt.eventType === 'answer') {
        map[taskId] = {
          ...current,
          opened: true,
          pending: true,
        }
      } else {
        // Совместимость со старыми локальными записями.
        map[taskId] = {
          ...current,
          id: attempt.id,
          attemptsUsed:
            attempt.attempts_used || attempt.attemptsUsed || 0,
          completed: Boolean(attempt.completed),
          failed: Boolean(attempt.failed),
          opened: Boolean(attempt.opened),
          timeSpent: attempt.time_spent || attempt.timeSpent || 0,
        }
      }
    }

    setHasPendingConfirmation(
      Object.values(map).some(attempt => attempt.pending)
    )

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
  }, [tasks, findNextTaskIndex, userId])

  // ----- Инициализация попытки (исправленная офлайн-логика) -----
  const initializeAttempt = useCallback(async () => {
    if (!hasStarted || !isAvailable || !quest || tasks.length === 0 || initAttemptDone) return

    const userId = session?.user?.id
    if (!userId) {
      toast.error('Пользователь не авторизован')
      return
    }

    const effectiveParticipantProfileId = participantProfileId || userId
    const initializationKey = `${id}:${userId}:${effectiveParticipantProfileId}`

    if (attemptInitializationKeyRef.current === initializationKey) return
    attemptInitializationKeyRef.current = initializationKey

    let online = isOnlineRef.current
    let attemptId = null

    if (online) {
      try {
          // Сервер атомарно создаёт либо возвращает активную попытку.
          const serverAttempt = await startServerQuestAttempt(id, participantProfileId)

          attemptId = serverAttempt.id

          setCompletedTasks(serverAttempt.completed_tasks || 0)
          setFailedTasks(serverAttempt.failed_tasks || 0)
          setTotalAttempts(serverAttempt.total_attempts || 0)
          setTotalTime(serverAttempt.total_time || 0)

          // Используем серверный UUID также как локальный ключ. Это позволяет
          // продолжить попытку после потери сети и повторно связать события.
          await saveQuestAttempt(
            attemptId,
            id,
            userId,
            attemptId,
            true,
            Boolean(serverAttempt.finished_at),
            effectiveParticipantProfileId
          )

          sessionStorage.setItem(`questAttempt_${id}_${effectiveParticipantProfileId}`, attemptId)
      } catch (error) {
        if (!isTransportError(error)) throw error

        online = false
        isOnlineRef.current = false
        setIsOnline(false)
      }
    }

    if (!online) {
      // Офлайн-режим
      const storageKey = `questAttempt_${id}_${effectiveParticipantProfileId}`
      let stored = sessionStorage.getItem(storageKey)
      let localAttempt = null

      if (stored) {
        // Проверяем, не завершена ли эта попытка
        const existingAttempt = await getQuestAttempt(stored)
        if (
          existingAttempt &&
          existingAttempt.userId === userId &&
          !existingAttempt.finished
        ) {
          attemptId = stored
        } else {
          // Попытка завершена или не найдена – создаём новую
          stored = null
        }
      }

      if (!stored) {
        localAttempt = await getActiveLocalQuestAttempt(id, userId, effectiveParticipantProfileId)
        if (!localAttempt || localAttempt.finished) {
          const localId = `local-${Date.now()}`
          await saveQuestAttempt(localId, id, userId, null, false, false, effectiveParticipantProfileId)
          localAttempt = await getActiveLocalQuestAttempt(id, userId, effectiveParticipantProfileId)
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
    setHasExistingAttempt(true)
    await loadTaskAttempts(attemptId)
    setStartTime(Date.now())
    setInitAttemptDone(true)
    toast.success('🔓 Квест открыт!')
  }, [hasStarted, isAvailable, quest, tasks, id, session, initAttemptDone, loadTaskAttempts, participantProfileId])

  // Запуск инициализации
  useEffect(() => {
    if (hasStarted && isAvailable && !initAttemptDone) {
      const timeout = setTimeout(() => {
        initializeAttempt().catch(err => {
          attemptInitializationKeyRef.current = null
          if (err.message?.includes('quest completion limit reached')) {
            setAttemptLimitReached(true)
            setHasStarted(false)
            toast.error('Лимит прохождений этого квеста исчерпан')
          } else {
            setHasStarted(false)
            toast.error(`Не удалось открыть квест: ${err.message}`)
          }
        })
      }, 0)

      return () => clearTimeout(timeout)
    }
  }, [hasStarted, isAvailable, initAttemptDone, initializeAttempt])

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

      if (existing) {
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
        const newEntry = {
          id: null,
          attemptsUsed: 0,
          completed: false,
          failed: false,
          opened: false,
          timeSpent: 0,
        }

        setTaskAttemptsMap(prev => ({
          ...prev,
          [taskId]: newEntry,
        }))
      }
    }

    initTask()
  }, [currentTaskIndex, currentTask, questAttemptId, initAttemptDone, finished, taskAttemptsMap, tasks, findNextTaskIndex])

  // ----- Серверная проверка доступа к заданию -----
  const submitOpenTask = useCallback(async ({
    latitude = null,
    longitude = null,
  } = {}) => {
    if (
      !currentTask ||
      !questAttemptId ||
      !isLocationPhase ||
      openingTask
    ) {
      return
    }

    const requiresGps = Boolean(currentTask.requires_gps)
    const requiresCode = Boolean(currentTask.requires_code)
    const acceptsAnyLocationCheck = usesAnyLocationVerification(
      quest,
      currentTask
    )
    const submittedCode = requiresCode ? codeInput.trim() : null

    if (
      requiresCode &&
      !submittedCode &&
      !(acceptsAnyLocationCheck && latitude !== null && longitude !== null)
    ) {
      toast.error('Введите код доступа')
      return
    }

    if (
      requiresGps &&
      (latitude === null || longitude === null) &&
      !(acceptsAnyLocationCheck && submittedCode)
    ) {
      toast.error('Не удалось получить координаты устройства')
      return
    }

    setOpeningTask(true)

    try {
      if (
        quest.verification_mode === 'hybrid' &&
        requiresCode &&
        submittedCode &&
        currentTask.code_verifier
      ) {
        try {
          const locallyMatches = await verifyHybridCandidate(
            submittedCode,
            currentTask.code_verifier
          )

          if (!locallyMatches && !isOnlineRef.current) {
            toast.error(
              '❌ Код не прошёл предварительную проверку'
            )
            return
          }
        } catch {
          // Повреждённый или неподдерживаемый verifier не является
          // источником истины: продолжаем через сервер или pending.
          toast.error(
            'Локальная проверка недоступна — результат проверит сервер'
          )
        }
      }

      if (!isOnlineRef.current) {
        if (quest.offline_progress_policy === 'block') {
          toast.error(
            'Этот квест нельзя продолжать без подключения к интернету'
          )
          return
        }

        await enqueuePendingEvent(
          quest.id,
          currentTask.id,
          questAttemptId,
          {
            eventType: 'open',
            submittedValue: submittedCode,
            latitude,
            longitude,
          }
        )

        setTaskAttemptsMap(prev => ({
          ...prev,
          [currentTask.id]: {
            ...prev[currentTask.id],
            opened: true,
            pendingOpen: true,
          },
        }))

        setLocationVerified(requiresGps)
        setCodeVerified(requiresCode)
        setIsLocationPhase(false)

        toast.success(
          '⏳ Проверка сохранена и будет подтверждена сервером'
        )
        return
      }

      const serverState = await submitTaskEvent({
        questAttemptId,
        taskId: currentTask.id,
        clientEventId: createClientEventId(),
        eventType: 'open',
        submittedValue: submittedCode,
        latitude,
        longitude,
      })

      setTaskAttemptsMap(prev => ({
        ...prev,
        [currentTask.id]: {
          ...prev[currentTask.id],
          id: serverState.task_attempt_id,
          opened: Boolean(serverState.opened),
          pendingOpen: false,
        },
      }))

      if (serverState.opened && serverState.accepted) {
        setLocationVerified(requiresGps)
        setCodeVerified(requiresCode)
        setIsLocationPhase(false)
        toast.success('🔓 Задание открыто!')
      } else {
        toast.error('Проверка места или кода не пройдена')
      }
    } catch (err) {
      toast.error(`Ошибка открытия задания: ${err.message}`)
    } finally {
      setOpeningTask(false)
    }
  }, [
    codeInput,
    currentTask,
    isLocationPhase,
    openingTask,
    quest,
    questAttemptId,
  ])

  function checkLocation() {
    if (!navigator.geolocation) {
      toast.error('Ваш браузер не поддерживает геолокацию')
      return
    }

    toast.loading('Определение местоположения...', {
      id: 'geolocation',
    })

    navigator.geolocation.getCurrentPosition(
      position => {
        toast.dismiss('geolocation')

        submitOpenTask({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      error => {
        toast.dismiss('geolocation')
        toast.error(getGeolocationErrorMessage(error))
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }

  function checkCode() {
    if (
      currentTask.requires_gps &&
      quest.verification_match_policy !== 'any'
    ) {
      checkLocation()
      return
    }

    submitOpenTask()
  }

  useEffect(() => {
    if (
      currentTask &&
      questAttemptId &&
      isLocationPhase &&
      !currentTask.requires_gps &&
      !currentTask.requires_code
    ) {
      const timeout = setTimeout(() => submitOpenTask(), 0)
      return () => clearTimeout(timeout)
    }
  }, [
    currentTask,
    isLocationPhase,
    questAttemptId,
    submitOpenTask,
  ])

  // ----- Завершение задания -----
  async function completeTask() {
    if (taskCompleted || taskFailed) return

    const hasAnswer = Boolean(currentTask.requires_answer)

    let submittedValue = null

    if (hasAnswer) {
      submittedValue =
        Array.isArray(currentTask.options) && currentTask.options.length > 0
          ? selectedOption.trim()
          : answerInput.trim()

      if (!submittedValue) {
        toast.error(
          'Пожалуйста, выберите вариант или введите ответ перед завершением'
        )
        return
      }
    }

    if (
      quest.verification_mode === 'hybrid' &&
      hasAnswer &&
      currentTask.answer_verifier
    ) {
      try {
        const locallyMatches = await verifyHybridCandidate(
          submittedValue,
          currentTask.answer_verifier
        )

        if (!locallyMatches && !isOnlineRef.current) {
          toast.error(
            '❌ Ответ не прошёл предварительную проверку'
          )
          return
        }
      } catch {
        // Не доверяем повреждённому verifier и не подменяем сервер.
        toast.error(
          'Локальная проверка недоступна — результат проверит сервер'
        )
      }
    }

    if (isOnlineRef.current) {
      try {
        const serverState = await submitTaskEvent({
          questAttemptId,
          taskId: currentTask.id,
          clientEventId: createClientEventId(),
          eventType: 'answer',
          submittedValue,
        })

        const attemptsUsed = serverState.attempts_used || 0
        setTaskAttemptsUsed(attemptsUsed)
        setTaskCompleted(Boolean(serverState.completed))
        setTaskFailed(Boolean(serverState.failed))

        const newMap = {
          ...taskAttemptsMap,
          [currentTask.id]: {
            ...taskAttemptsMap[currentTask.id],
            id: serverState.task_attempt_id,
            opened: Boolean(serverState.opened),
            completed: Boolean(serverState.completed),
            failed: Boolean(serverState.failed),
            attemptsUsed,
          },
        }

        setTaskAttemptsMap(newMap)

        const serverAttempt = serverState.quest_attempt || {}
        setCompletedTasks(serverAttempt.completed_tasks || 0)
        setFailedTasks(serverAttempt.failed_tasks || 0)
        setTotalAttempts(serverAttempt.total_attempts || 0)
        setTotalTime(serverAttempt.total_time || 0)

        const answerResult = getAnswerResultMessage(serverState)
        if (answerResult.type === 'success') {
          toast.success(`✅ ${answerResult.message}`)
        } else if (answerResult.type === 'terminal') {
          toast(answerResult.message, { icon: '⚠️' })
        } else {
          toast.error(`❌ ${answerResult.message}`)
        }

        if (serverState.terminal) {
          const nextIndex = findNextTaskIndex(newMap)

          if (serverAttempt.finished_at) {
            setFinished(true)

            try {
              await finalizeTrustedQuestAttempt(
                questAttemptId,
                id,
                participantProfileId || session?.user?.id
              )
              setHasExistingAttempt(false)
            } catch (cleanupError) {
              console.error(
                'Не удалось очистить завершённую локальную попытку:',
                cleanupError
              )
            }
          } else if (nextIndex === -1) {
            setFinished(true)
          } else {
            setCurrentTaskIndex(nextIndex)
          }
        }

        return
      } catch (err) {
        toast.error(`Ошибка проверки ответа: ${err.message}`)
        return
      }
    }

    // Offline-событие остаётся pending. Локальная PBKDF2-проверка
    // не создаёт доверенный результат и не изменяет серверный лимит.
    if (quest.offline_progress_policy === 'block') {
      toast.error(
        'Этот квест нельзя продолжать без подключения к интернету'
      )
      return
    }

    const clientElapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - taskStartTime) / 1000)
    )

    await enqueuePendingEvent(
      quest.id,
      currentTask.id,
      questAttemptId,
      {
        eventType: 'answer',
        submittedValue,
        clientElapsedSeconds,
      }
    )

    const newMap = {
      ...taskAttemptsMap,
      [currentTask.id]: {
        ...taskAttemptsMap[currentTask.id],
        opened: true,
        completed: false,
        failed: false,
        pending: true,
      },
    }

    setTaskAttemptsMap(newMap)
    setHasPendingConfirmation(true)

    toast.success(
      '⏳ Ответ сохранён и ожидает серверной проверки'
    )

    const nextIndex = findNextTaskIndex(newMap)

    if (nextIndex === -1) {
      setFinished(true)
    } else {
      setCurrentTaskIndex(nextIndex)
    }
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
    sessionStorage.removeItem(`questAttempt_${id}_${participantProfileId || session?.user?.id}`)
    navigate('/quests')
  }

  const participantSelector = (
    <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-8 sm:pt-8">
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ParticipantProfileSelect
          value={participantProfileId || ''}
          onChange={handleParticipantChange}
          onProfilesLoaded={handleProfilesLoaded}
          userId={session?.user?.id}
          fallbackProfiles={offlineFallbackProfiles}
          label="Участник квеста"
        />
        {selectedParticipantProfile?.relationship !== 'self' && !participantModeIsActive && (
          <div className="mt-4 rounded-lg bg-amber-50 p-4">
            <p className="font-medium text-amber-950">Защитите кабинет взрослого</p>
            <p className="mt-1 text-sm text-amber-900">Придумайте временный PIN из 4–6 цифр. Он потребуется для выхода из детского режима.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label><span className="text-sm">PIN</span><input type="password" inputMode="numeric" autoComplete="off" value={participantModePin} onChange={event => setParticipantModePin(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1 w-full rounded-lg border p-2" /></label>
              <label><span className="text-sm">Повторите PIN</span><input type="password" inputMode="numeric" autoComplete="off" value={participantModePinConfirmation} onChange={event => setParticipantModePinConfirmation(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1 w-full rounded-lg border p-2" /></label>
            </div>
            {participantModeError && <p role="alert" className="mt-2 text-sm text-red-700">{participantModeError}</p>}
          </div>
        )}
      </div>
    </div>
  )

  // ----- Рендеры -----
  if (loading) return <Loader text="Загрузка квеста..." />
  if (error) {
    const accessErrorMessage = getQuestAccessErrorMessage(error)
    if (accessErrorMessage) {
      return (
        <div className="min-h-screen bg-gray-50">
          {participantSelector}
          <div className="flex flex-col items-center justify-center p-8">
          <div className="bg-white p-8 rounded-sm shadow-sm max-w-md text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">⛔ Квест недоступен</h2>
            <p className="text-gray-700">{accessErrorMessage}</p>
            <button onClick={() => navigate('/quests')} className="mt-6 bg-blue-500 text-white px-4 py-2 rounded-sm hover:bg-blue-600">
              На главную
            </button>
          </div>
          </div>
        </div>
      )
    }
    return <div className="p-8 text-red-500">Не удалось загрузить квест. Попробуйте ещё раз.</div>
  }
  if (!isAvailable) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gray-50">
        <div className="bg-white p-8 rounded-sm shadow-sm max-w-md text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">⛔ Квест недоступен</h2>
          <p className="text-gray-700">{availabilityMessage}</p>
          {timeUntilStart !== null && timeUntilStart > 0 && (
            <div className="mt-4 text-3xl font-mono font-bold text-blue-600">
              {formatTime(timeUntilStart)}
            </div>
          )}
          <button onClick={() => navigate('/')} className="mt-6 bg-blue-500 text-white px-4 py-2 rounded-sm hover:bg-blue-600">
            На главную
          </button>
        </div>
      </div>
    )
  }
  if (!quest || tasks.length === 0) {
    return <div className="p-8">В этом квесте пока нет заданий</div>
  }
  if (!hasStarted) {
    return (
      <>
        {participantSelector}
        <QuestStartScreen
          quest={quest}
          taskCount={tasks.length}
          isOnline={isOnline}
          offlinePackageStatus={offlinePackageStatus}
          offlinePackageMetadata={offlinePackageMetadata}
          hasExistingAttempt={hasExistingAttempt}
          startDisabled={attemptLimitReached}
          startMessage={attemptLimitReached
            ? 'Вы использовали все доступные прохождения этого квеста.'
            : ''}
          onStart={() => void handleStart()}
        />
      </>
    )
  }
  if (!initAttemptDone) {
    return <Loader text="Открываем квест..." />
  }
  if (finished) {
    const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 p-8">
        {hasPendingConfirmation && (
          <div className="mb-6 max-w-lg rounded-sm border border-yellow-300 bg-yellow-50 p-4 text-center text-yellow-900">
            ⏳ Результаты сохранены локально и ожидают подтверждения
            сервером. Итоговая статистика может измениться после
            синхронизации.
          </div>
        )}
        <h1 className="text-4xl font-bold text-green-600">
          {hasPendingConfirmation
            ? '⏳ Квест ожидает проверки'
            : '🏁 Квест завершён!'}
        </h1>
        <p className="text-xl mt-4">Завершено заданий: {completedTasks + failedTasks} из {totalTasks}</p>
        <p className="text-lg mt-2">✅ Успешно: {completedTasks} | ❌ Неуспешно: {failedTasks}</p>
        <p className="text-lg">⏱️ Время: {elapsedSeconds} секунд</p>
        <p className="text-lg">🎯 Процент успеха: {percent}%</p>
        {!hasPendingConfirmation && (
          <p className="mt-4 rounded-lg bg-white px-4 py-2 text-green-800 shadow-sm">
            ✅ Результат сохранён и подтверждён сервером
          </p>
        )}
        <button onClick={() => navigate('/')} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded-sm hover:bg-blue-600">
          На главную
        </button>
      </div>
    )
  }

  if (showTaskSummary) {
    return (
      <QuestTaskSummary
        quest={quest}
        tasks={tasks}
        taskAttemptsMap={taskAttemptsMap}
        serverSummary={questSummary}
        isOnline={isOnline}
        onSelectTask={index => {
          setCurrentTaskIndex(index)
          setShowTaskSummary(false)
        }}
        onExit={handleExit}
      />
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold">{quest.title}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowTaskSummary(true)}
            className="rounded-sm border border-blue-500 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
          >
            К списку заданий
          </button>
          <button
            type="button"
            onClick={handleExit}
            className="text-red-500 hover:text-red-700 text-sm border border-red-500 px-3 py-1 rounded-sm hover:bg-red-50"
          >
            ✕ Выйти из квеста
          </button>
        </div>
      </div>
      <div className="flex justify-between items-center mb-2 text-sm text-gray-600">
        <span>Прогресс</span>
        <span>{openedTaskCount} из {progressTaskCount}</span>
        <span>⏱️ {elapsedSeconds} сек</span>
      </div>
      <div
        className="w-full bg-gray-200 rounded-full h-2.5 mb-4"
        role="progressbar"
        aria-label="Прогресс по открытым заданиям"
        aria-valuemin="0"
        aria-valuemax={progressTaskCount}
        aria-valuenow={openedTaskCount}
        aria-valuetext={`${openedTaskCount} из ${progressTaskCount}`}
      >
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${progressTaskCount > 0 ? openedTaskCount / progressTaskCount * 100 : 0}%` }}
        />
      </div>
      <div className="bg-white shadow-sm rounded-sm p-6">
        <h2 className="text-xl font-semibold mb-2">{currentTask.title}</h2>
        {(currentTask.location_text || currentTask.location_image_url) && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-sm">
            <h4 className="font-semibold text-blue-700 mb-1">
              📍 Место задания
            </h4>

            {currentTask.location_text && (
              <p className="text-sm text-gray-700 mt-1">
                {currentTask.location_text}
              </p>
            )}

            {currentTask.location_image_url && (
              <img
                src={currentTask.location_image_url}
                alt="Место"
                className="mt-2 max-w-full h-auto rounded-sm max-h-40 object-cover"
              />
            )}
          </div>
        )}
        <TaskLocationMap
          latitude={currentTask.location_latitude}
          longitude={currentTask.location_longitude}
          isOnline={isOnline}
          taskNumber={currentTaskIndex + 1}
          verificationRadiusMeters={currentTask.requires_gps ? 50 : null}
        />
        {isLocationPhase && (
          <div className="border-t border-blue-200 pt-4 mt-4">
            <p className="text-gray-700 mb-3">Для доступа к заданию необходимо подтвердить нахождение на месте:</p>
            {quest.verification_options.includes('gps') && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={checkLocation}
                  disabled={locationVerified || openingTask}
                  className={`px-4 py-2 rounded-sm ${locationVerified ? 'bg-green-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                >
                  {locationVerified ? '✅ На месте' : '📍 Я на месте'}
                </button>
              </div>
            )}
            {currentTask.requires_code && (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <label htmlFor="task-access-code" className="sr-only">
                  Код доступа к заданию
                </label>
                <input
                  id="task-access-code"
                  type="text"
                  placeholder="Введите код доступа"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  disabled={codeVerified || openingTask}
                  className="border p-2 rounded-sm flex-1"
                />
                <button
                  type="button"
                  onClick={checkCode}
                  disabled={codeVerified || openingTask}
                  className="bg-amber-700 text-white px-4 py-2 rounded-sm hover:bg-amber-800"
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
                  <img src={currentTask.media_url} alt="Медиа" className="max-w-full h-auto rounded-sm" />
                )}
                {getMediaType(currentTask.media_url) === 'video' && (
                  <video controls className="max-w-full h-auto rounded-sm">
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
                <p className="mt-1 text-gray-600 bg-gray-100 p-2 rounded-sm">{currentTask.hint}</p>
              </details>
            )}
            {currentTask.requires_answer && (
              <div className="mb-3">
                {currentTask.options && Array.isArray(currentTask.options) && currentTask.options.length > 0 ? (
                  <fieldset className="space-y-2">
                    <legend className="font-medium">Выберите правильный вариант:</legend>
                    {currentTask.options.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedOption(opt)}
                        aria-pressed={selectedOption === opt}
                        className={`block w-full text-left p-2 border rounded-sm transition ${
                          selectedOption === opt ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </fieldset>
                ) : (
                  <div>
                    <label htmlFor="task-answer" className="sr-only">
                      Ответ на задание
                    </label>
                    <input
                      id="task-answer"
                      type="text"
                      placeholder="Введите ваш ответ"
                      value={answerInput}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      disabled={taskCompleted || taskFailed}
                      className="w-full border p-2 rounded-sm"
                    />
                  </div>
                )}
                {maxAttempts > 0 && (
                  <p className="text-sm text-gray-500 mt-1">Попыток: {taskAttemptsUsed} / {maxAttempts}</p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={completeTask}
              disabled={taskCompleted || taskFailed}
              className={`w-full py-3 rounded-sm text-white ${
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
