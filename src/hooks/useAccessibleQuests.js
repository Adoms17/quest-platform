import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { getOfflineAccessiblePrivateQuests } from '../services/db'
import { listAccessiblePrivateQuests } from '../services/questApi'
import { isAbortError } from '../services/requestCancellation'
import { getUserErrorMessage } from '../services/userErrorMessage'
export function useAccessibleQuests(userId) {
  const [accessibleQuests, setAccessibleQuests] = useState([])
  const [accessibleQuestsLoading, setAccessibleQuestsLoading] = useState(true)
  const [usingOfflineAccessibleQuests, setUsingOfflineAccessibleQuests] = useState(false)
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

  return { accessibleQuests, accessibleQuestsLoading, usingOfflineAccessibleQuests }
}
