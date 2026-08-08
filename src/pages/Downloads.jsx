import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDownloadedQuests,
  removeQuestFromDB,
  getQuestFromDB,
  clearAllLocalData,
  getPendingResults,
} from '../services/db'
import { 
  syncPendingResults, 
  syncPendingResultsWithRetry, 
  SYNC_COMPLETE_EVENT} from '../services/sync'
import Loader from '../components/Loader'
import toast from 'react-hot-toast'

//const SYNC_COMPLETE_EVENT = 'quest-sync-complete'

export default function Downloads({ session }) {
  const navigate = useNavigate()
  const [quests, setQuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncErrors, setSyncErrors] = useState({})

  const loadDownloads = async () => {
    setLoading(true)
    try {
      const downloaded = await getDownloadedQuests()
      const pending = await getPendingResults()
      const questsWithStatus = []
      for (const d of downloaded) {
        const localQuest = await getQuestFromDB(d.questId)
        const hasUnsynced = pending.some(p => p.questId === d.questId && !p.synced)
        questsWithStatus.push({
          questId: d.questId,
          downloadedAt: d.downloadedAt,
          lastSyncDate: d.lastSyncDate || null,
          title: localQuest?.title || 'Без названия',
          hasUnsynced,
        })
      }
      setQuests(questsWithStatus)
    } catch (err) {
      toast.error('Ошибка загрузки списка: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDownloads()
  }, [])

  // Подписка на событие успешной синхронизации
  useEffect(() => {
    const handleSyncComplete = () => {
      loadDownloads() // обновляем список после синхронизации
    }
    window.addEventListener(SYNC_COMPLETE_EVENT, handleSyncComplete)
    return () => {
      window.removeEventListener(SYNC_COMPLETE_EVENT, handleSyncComplete)
    }
  }, [])

  async function handleDelete(questId) {
    if (!confirm('Удалить загруженный квест?')) return
    await removeQuestFromDB(questId)
    setQuests(quests.filter(q => q.questId !== questId))
    toast.success('Квест удалён из загрузок')
  }

  async function handleSyncAll() {
    if (syncing) return
    setSyncing(true)
    setSyncErrors({})
    try {
      await syncPendingResults(session)
      // После успешной синхронизации loadDownloads вызывается через событие
      // но на всякий случай обновим и здесь
      await loadDownloads()
    } catch (err) {
      // Ошибка уже показана в sync.js
      // Но мы можем обновить список, чтобы отразить возможные изменения
      await loadDownloads()
    } finally {
      setSyncing(false)
    }
  }

  async function handleSyncSingle(questId) {
    setSyncing(true)
    setSyncErrors({})
    try {
      await syncPendingResults(session)
      await loadDownloads()
      toast.success(`Результаты синхронизированы`)
    } catch (err) {
      setSyncErrors(prev => ({ ...prev, [questId]: err.message }))
      toast.error('Не удалось синхронизировать результаты')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <Loader text="Загрузка загруженных квестов..." />

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">📥 Мои загрузки</h1>
        <button
          onClick={handleSyncAll}
          disabled={syncing || quests.every(q => !q.hasUnsynced)}
          className={`px-4 py-2 rounded text-white ${
            syncing || quests.every(q => !q.hasUnsynced)
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {syncing ? 'Синхронизация...' : '🔄 Синхронизировать всё'}
        </button>
      </div>

      {quests.length === 0 ? (
        <p className="text-gray-500">
          У вас нет загруженных квестов. Скачайте квест из списка, чтобы проходить его офлайн.
        </p>
      ) : (
        <ul className="space-y-4">
          {quests.map(q => {
            const hasError = !!syncErrors[q.questId]
            const canPlay = !q.hasUnsynced && !hasError
            const canSync = q.hasUnsynced && !syncing

            return (
              <li key={q.questId} className="border p-4 rounded shadow">
                <div className="flex flex-wrap justify-between items-start gap-2">
                  <div>
                    <h3 className="font-medium text-lg">{q.title}</h3>
                    <div className="text-sm text-gray-500 space-y-1">
                      <div>Скачан: {new Date(q.downloadedAt).toLocaleString()}</div>
                      {q.lastSyncDate && (
                        <div>Последняя синхронизация: {new Date(q.lastSyncDate).toLocaleString()}</div>
                      )}
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${
                            q.hasUnsynced ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                        />
                        <span>
                          {q.hasUnsynced
                            ? 'Есть несинхронизированные результаты'
                            : 'Нет ожидающих синхронизации'}
                        </span>
                      </div>
                      {hasError && (
                        <div className="text-red-500 text-sm">
                          ⚠️ Ошибка синхронизации: {syncErrors[q.questId]}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => navigate(`/play/${q.questId}`)}
                      disabled={!canPlay}
                      className={`px-3 py-1 rounded text-sm ${
                        canPlay
                          ? 'bg-blue-500 text-white hover:bg-blue-600'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                      title={!canPlay && q.hasUnsynced ? 'Сначала синхронизируйте результаты' : ''}
                    >
                      🚀 Пройти офлайн
                    </button>
                    <button
                      onClick={() => handleSyncSingle(q.questId)}
                      disabled={!canSync || syncing}
                      className={`px-3 py-1 rounded text-sm ${
                        canSync && !syncing
                          ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {syncing ? '...' : '🔄 Синхронизировать'}
                    </button>
                    <button
                      onClick={() => handleDelete(q.questId)}
                      className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
                    >
                      🗑️ Удалить
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-6 flex gap-2">
        <button
          onClick={async () => {
            if (confirm('Очистить все локальные данные?')) {
              await clearAllLocalData()
              toast.success('Локальные данные очищены')
              loadDownloads()
            }
          }}
          className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
        >
          Сбросить все данные
        </button>
      </div>
    </div>
  )
}