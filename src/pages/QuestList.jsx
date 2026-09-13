import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link, useNavigate } from 'react-router-dom'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'
import {
  getOfflineAccessiblePrivateQuests,
  saveQuestToDB,
} from '../services/db'
import { useOrganization } from '../contexts/useOrganization'
import QuickQuestAccessCode from '../components/QuickQuestAccessCode'
import AccessiblePrivateQuests from '../components/AccessiblePrivateQuests'
import { listAccessiblePrivateQuests } from '../services/questApi'
import { getUserErrorMessage } from '../services/userErrorMessage'
import { isAbortError, withAbortSignal } from '../services/requestCancellation'

export default function QuestList({ session }) {
  const navigate = useNavigate()
  const [quests, setQuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [accessibleQuests, setAccessibleQuests] = useState([])
  const [accessibleQuestsLoading, setAccessibleQuestsLoading] = useState(true)
  const [usingOfflineAccessibleQuests, setUsingOfflineAccessibleQuests] = useState(false)
  const [copying, setCopying] = useState(null) // id квеста, который копируется
  const {
    currentOrganization,
    loadingOrganizations,
    organizationError,
  } = useOrganization()
  const currentOrganizationId = currentOrganization?.id
  const canManageAccess = currentOrganization?.roles?.some(role =>
    ['owner', 'admin', 'participant_manager', 'sales_manager'].includes(role.key)
  )

  const userId = session?.user?.id

  const fetchQuests = useCallback(async (signal) => {
    setLoading(true)
    if (!currentOrganizationId) {
      setQuests([])
      setLoading(false)
      return
    }

    const query = supabase
      .from('quests')
      .select('*')
      .eq('organization_id', currentOrganizationId)
      .order('created_at', { ascending: false })
    const { data, error } = await withAbortSignal(query, signal)
    if (signal?.aborted) return

    if (error) {
      console.error('Ошибка загрузки квестов:', error)
      toast.error(getUserErrorMessage(error, 'Не удалось загрузить квесты.'))
    } else {
      setQuests(data || [])
    }
    setLoading(false)
  }, [currentOrganizationId])

  const fetchAccessibleQuests = useCallback(async (signal) => {
    setAccessibleQuestsLoading(true)
    const loadOfflineQuests = async () => {
      try {
        return await getOfflineAccessiblePrivateQuests(userId)
      } catch {
        return []
      }
    }

    try {
      if (!navigator.onLine) {
        const offlineQuests = await loadOfflineQuests()
        if (signal?.aborted) return
        setAccessibleQuests(offlineQuests)
        setUsingOfflineAccessibleQuests(true)
        return
      }

      const remoteQuests = await listAccessiblePrivateQuests(signal)
      if (signal?.aborted) return
      setAccessibleQuests(remoteQuests)
      setUsingOfflineAccessibleQuests(false)
    } catch (error) {
      if (isAbortError(error, signal)) return
      console.error('Ошибка загрузки доступных приватных квестов:', error)
      const offlineQuests = await loadOfflineQuests()
      if (signal?.aborted) return
      setAccessibleQuests(offlineQuests)
      setUsingOfflineAccessibleQuests(true)
      if (navigator.onLine && offlineQuests.length === 0) {
        toast.error(getUserErrorMessage(
          error,
          'Не удалось загрузить доступные приватные квесты.',
        ))
      }
    } finally {
      if (!signal?.aborted) setAccessibleQuestsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId || loadingOrganizations) return
    const controller = new AbortController()
    const timeout = setTimeout(() => fetchQuests(controller.signal), 0)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [userId, loadingOrganizations, fetchQuests])

  useEffect(() => {
    if (!userId) return

    let activeController = null
    const refresh = () => {
      activeController?.abort()
      activeController = new AbortController()
      return fetchAccessibleQuests(activeController.signal)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timeout = setTimeout(refresh, 0)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      clearTimeout(timeout)
      activeController?.abort()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [userId, fetchAccessibleQuests])

  async function handleDelete(id) {
    if (!confirm('Удалить квест?')) return
    const { error } = await supabase.from('quests').delete().eq('id', id)
    if (error) toast.error(getUserErrorMessage(error, 'Не удалось удалить квест.'))
    else {
      toast.success('Квест удалён')
      fetchQuests()
    }
  }

  async function copyQuest(questId) {
    if (!confirm('Создать копию этого квеста со всеми заданиями?')) return
    setCopying(questId)
    try {
      // 1. Получаем исходный квест
      const { data: original, error: fetchError } = await supabase
        .from('quests')
        .select('*')
        .eq('id', questId)
        .single()
      if (fetchError) throw fetchError

      // 2. Создаём новый квест (копия)
      const newQuest = {
        creator_id: session.user.id,
        organization_id: currentOrganization.id,
        title: original.title + ' (копия)',
        description: original.description,
        is_public: original.is_public,
        verification_options: original.verification_options,
        location_options: original.location_options,
        max_attempts: original.max_attempts,
        max_quest_attempts: original.max_quest_attempts,
        is_open: original.is_open,
        start_at: original.start_at,
        end_at: original.end_at,
      }
      const { data: newQuestData, error: insertError } = await supabase
        .from('quests')
        .insert(newQuest)
        .select()
      if (insertError) throw insertError
      const newQuestId = newQuestData[0].id

      // 3. Копируем задания
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('quest_id', questId)
      if (tasksError) throw tasksError

      if (tasks && tasks.length > 0) {
        const newTasks = tasks.map(task => ({
          quest_id: newQuestId,
          title: task.title,
          description: task.description,
          hint: task.hint,
          gps_point: task.gps_point,
          static_code: task.static_code,
          correct_answer: task.correct_answer,
          options: task.options,
          location_text: task.location_text,
          location_image_url: task.location_image_url,
          order_index: task.order_index,
        }))
        const { error: insertTasksError } = await supabase
          .from('tasks')
          .insert(newTasks)
        if (insertTasksError) throw insertTasksError
      }

      toast.success('Квест скопирован!')
      fetchQuests() // обновляем список
    } catch (err) {
      toast.error(getUserErrorMessage(err, 'Не удалось скопировать квест.'))
    } finally {
      setCopying(null)
    }
  }

  if ((loading || loadingOrganizations) && accessibleQuestsLoading) {
    return <Loader text="Загрузка списка квестов..." />
  }

  if (!currentOrganization) {
    const organizationMessage = organizationError
      ? usingOfflineAccessibleQuests
        ? 'Создание и управление квестами будут доступны после подключения к интернету.'
        : getUserErrorMessage(organizationError, 'Не удалось загрузить организации.')
      : 'Нет доступной организации. Обратитесь к администратору.'

    return (
      <div className="p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Квесты</h1>
        <QuickQuestAccessCode
          onContinue={code => navigate(`/access/code?code=${encodeURIComponent(code)}`)}
        />
        <AccessiblePrivateQuests
          quests={accessibleQuests}
          loading={accessibleQuestsLoading}
          offline={usingOfflineAccessibleQuests}
        />
        <section className="rounded-sm border border-gray-200 bg-gray-50 p-4">
          <h2 className="font-semibold">Управление квестами</h2>
          <p className="mt-1 text-sm text-gray-600">{organizationMessage}</p>
        </section>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Квесты</h1>
          <p className="text-sm text-gray-500">{currentOrganization.name}</p>
        </div>
        <Link
          to="/quests/new"
          className="bg-blue-500 text-white px-4 py-2 rounded-sm hover:bg-blue-600"
        >
          + Создать квест
        </Link>
      </div>

      <QuickQuestAccessCode
        onContinue={code => navigate(`/access/code?code=${encodeURIComponent(code)}`)}
      />

      <AccessiblePrivateQuests
        quests={accessibleQuests}
        loading={accessibleQuestsLoading}
        offline={usingOfflineAccessibleQuests}
      />

      {quests.length === 0 ? (
        <p className="text-gray-500">У вас пока нет квестов. Создайте первый!</p>
      ) : (
        <div className="space-y-4">
          {quests.map((quest) => (
            <div key={quest.id} className="border p-4 rounded-sm shadow-sm flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold">{quest.title}</h2>
                <p className="text-gray-600 text-sm">
                  {quest.description || 'Без описания'} · {quest.is_public ? 'Без приглашения' : 'Доступ ограничен'}
                </p>
                <p className="text-xs text-gray-400">
                  Создан: {new Date(quest.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-500 mt-1">
                <span className={`px-2 py-1 rounded-sm ${quest.is_open ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {quest.is_open ? '✅ Открыт' : '❌ Закрыт'}
                </span>
                {quest.start_at && (
                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-sm">
                    🕐 Начало: {new Date(quest.start_at).toLocaleString()}
                  </span>
                )}
                {quest.end_at && (
                  <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-sm">
                    ⏰ Окончание: {new Date(quest.end_at).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 md:mt-0 md:flex md:flex-wrap md:justify-center">
                {canManageAccess && (
                  <Link
                    to={`/quests/${quest.id}/access`}
                    className="bg-indigo-600 text-white px-3 py-1 rounded-sm text-sm hover:bg-indigo-700 text-center flex items-center justify-center"
                  >
                    🎟️ Доступ
                  </Link>
                )}
                <Link
                  to={`/quests/${quest.id}/edit`}
                  className="bg-yellow-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-yellow-600 text-center flex items-center justify-center"
                >
                  ✏️ Редактировать
                </Link>
                <Link
                  to={`/quests/${quest.id}/stats`}
                  className="bg-green-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-green-600 text-center flex items-center justify-center"
                >
                  📊 Статистика
                </Link>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/play/${quest.id}`
                    navigator.clipboard.writeText(url)
                    toast.success('Ссылка скопирована!')
                  }}
                  className="bg-purple-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-purple-600 text-center flex items-center justify-center"
                >
                  🔗 Поделиться
                </button>
                <button
                  onClick={async () => {
                    try {
                      const { data: qData, error: qErr } = await supabase
                        .from('quests')
                        .select('*')
                        .eq('id', quest.id)
                        .single()
                      if (qErr) throw qErr
                      const { data: tData, error: tErr } = await supabase
                        .from('tasks')
                        .select('*')
                        .eq('quest_id', quest.id)
                        .order('order_index')
                      if (tErr) throw tErr
                      await saveQuestToDB(qData, tData)
                      toast.success('Квест скачан для офлайн-прохождения!')
                    } catch (err) {
                      toast.error(getUserErrorMessage(
                        err,
                        'Не удалось скачать квест для офлайн-прохождения.',
                      ))
                    }
                  }}
                  className="bg-blue-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-blue-600 text-center flex items-center justify-center"
                >
                  📥 Скачать
                </button>
                <button
                  onClick={() => copyQuest(quest.id)}
                  disabled={copying === quest.id}
                  className="bg-gray-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-gray-600 text-center flex items-center justify-center"
                >
                  {copying === quest.id ? '...' : '📋 Копировать'}
                </button>
                <button
                  onClick={() => handleDelete(quest.id)}
                  className="bg-red-500 text-white px-3 py-1 rounded-sm text-sm hover:bg-red-600 text-center flex items-center justify-center"
                >
                  🗑️ Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
