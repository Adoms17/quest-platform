import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDownloadedQuestPackages, getParticipantProfiles, getPendingResults, getLocalParticipantAttempts, removeQuestFromDB } from '../services/db'
import { syncPendingResults, SYNC_COMPLETE_EVENT } from '../services/sync'
import { PENDING_RESULT_ENQUEUED_EVENT } from '../services/syncSignals'
import { PARTICIPANT_DASHBOARD_CHANGED, packageReadiness } from '../services/participantDashboard'
import { getUserErrorMessage } from '../services/userErrorMessage'
import toast from 'react-hot-toast'

const bytes = size => {
  const value = size || 0
  const divisor = value < 1024 ? 1 : value < 1024 * 1024 ? 1024 : 1024 * 1024
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / divisor) + (divisor === 1 ? ' Б' : divisor === 1024 ? ' КБ' : ' МБ')
}
export default function Downloads({ session }) { return <Storage key={session?.user?.id} session={session} /> }
function Storage({ session }) {
  const userId = session?.user?.id
  const [state, setState] = useState({ packages: [], pending: [], profiles: [], loading: true, error: false })
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(25)
  const [syncing, setSyncing] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let active = true
    Promise.all([getDownloadedQuestPackages(Date.now(), userId), getParticipantProfiles(userId), getPendingResults(userId), getLocalParticipantAttempts(userId)]).then(([packages, profiles, pending, attempts]) => {
      const ids = new Set([...profiles.map(p => p.participant_profile_id), ...attempts.map(a => a.participantProfileId || a.userId)])
      if (active) setState({ packages: packages.filter(p => ids.has(p.participantProfileId)), profiles, pending: pending.filter(p => !p.synced), loading: false, error: false })
    }).catch(() => { if (active) setState(old => ({ ...old, loading: false, error: true })) })
    const events = [SYNC_COMPLETE_EVENT, PENDING_RESULT_ENQUEUED_EVENT, PARTICIPANT_DASHBOARD_CHANGED, 'focus', 'online', 'offline']
    events.forEach(event => window.addEventListener(event, refresh))
    return () => { active = false; events.forEach(event => window.removeEventListener(event, refresh)) }
  }, [userId, revision, refresh])
  const sync = async () => {
    if (syncing) return
    setSyncing(true)
    try { await syncPendingResults(session) }
    catch (error) { toast.error(getUserErrorMessage(error, 'Не удалось отправить события. Они сохранены на устройстве.')) }
    finally { setSyncing(false); refresh() }
  }
  const remove = async questId => {
    if (!confirm('Удалить материалы этого квеста для всех профилей на устройстве? Серверная история и попытки сохранятся.')) return
    try {
      await removeQuestFromDB(questId)
      window.dispatchEvent(new Event(PARTICIPANT_DASHBOARD_CHANGED))
      toast.success('Материалы удалены')
    } catch (error) { toast.error(getUserErrorMessage(error, 'Не удалось удалить материалы.')) }
  }
  const grouped = new Map()
  for (const pkg of state.packages) {
    if (!grouped.has(pkg.questId)) grouped.set(pkg.questId, { ...pkg, participants: [] })
    grouped.get(pkg.questId).participants.push(pkg)
  }
  const items = [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const filtered = items.filter(item => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="participant-dashboard">
    <Link to="/my-quests" className="text-blue-700">Мои квесты</Link>
    <h1 className="mb-3 mt-4 text-2xl font-bold">Хранилище</h1>
    <p className="mb-5 text-slate-600">Материалы этого аккаунта на устройстве: {bytes(items.reduce((sum, item) => sum + (item.packageSizeBytes || 0), 0))}. Общий пакет нескольких профилей посчитан один раз.</p>
    {state.error && <p role="alert">Не удалось прочитать хранилище. <button onClick={refresh} className="text-blue-700">Повторить</button></p>}
    {state.pending.length > 0 && <section className="participant-pending" aria-label="Ожидающие события">
      <h2>Ожидают отправки: {state.pending.filter(item => item.reviewState !== 'needs_review').length}</h2>
      {state.pending.some(item => item.reviewState === 'needs_review') && <p>Требуют проверки организатора: {state.pending.filter(item => item.reviewState === 'needs_review').length}. Сохранены на сервере и этом устройстве; в результат не засчитаны.</p>}
      <p className="mt-1 text-sm font-normal">Открытия заданий, ответы и завершения. События сохраняются до подтверждения сервера, даже если материалы или доступ больше недоступны.</p>
      <button className="participant-download mt-3" onClick={sync} disabled={syncing || !navigator.onLine}>{syncing ? 'Отправляем…' : 'Отправить сейчас'}</button>
      {!navigator.onLine && <p className="mt-2 text-sm font-normal">Отправка возобновится после подключения к интернету.</p>}
      {syncing && <p role="status" className="mt-2 text-sm">Проверяем подтверждения и отправляем оставшиеся события…</p>}
    </section>}
    {state.loading ? <p role="status">Читаем хранилище…</p> : <>
      <label className="quest-search"><input aria-label="Найти сохранённый квест" type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(25) }} placeholder="Найти квест" /></label>
      {!items.length && <p className="my-5">Пока нет скачанных квестов для этого аккаунта. <Link to="/my-quests" className="text-blue-700">Перейти к доступным квестам</Link></p>}
      {items.length > 0 && !filtered.length && <p className="my-5">Квесты не найдены.</p>}
      <ul className="space-y-4 mt-5">{filtered.slice(0, limit).map(item => {
        const pending = state.pending.some(p => p.questId === item.questId)
        return <li className="rounded-xl border border-slate-200 p-4" key={item.questId}>
          <h2 className="font-semibold break-words">{item.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{item.packageSizeBytes ? bytes(item.packageSizeBytes) : 'Размер неизвестен'} · Скачан: {new Date(item.downloadedAt).toLocaleString('ru-RU')}</p>
          <ul className="mt-3 space-y-2">{item.participants.map(pkg => <li className="text-sm" key={pkg.participantProfileId}>
            <strong>{state.profiles.find(p => p.participant_profile_id === pkg.participantProfileId)?.display_name || 'Сохранённый профиль'}</strong>: {packageReadiness(pkg).text}
            {pkg.expiresAt && <span className="block text-slate-600">Офлайн-доступ до {new Date(pkg.expiresAt).toLocaleString('ru-RU')}</span>}
          </li>)}</ul>
          {item.offlineMediaFailures?.length > 0 && <p className="mt-3 text-sm text-amber-800">Недоступных ресурсов: {item.offlineMediaFailures.length}. Для повторной загрузки откройте квест в «Моих квестах» и нажмите «Обновить».</p>}
          {pending && <p className="mt-3 text-sm text-amber-800">Удаление материалов недоступно: есть события, ожидающие отправки.</p>}
          <button className="mt-3 rounded-lg px-3 py-3 text-red-700 disabled:opacity-50" disabled={pending || syncing} onClick={() => remove(item.questId)}>Удалить материалы</button>
        </li>
      })}</ul>
      {filtered.length > limit && <button className="participant-download mt-4" onClick={() => setLimit(value => value + 25)}>Показать ещё</button>}
    </>}
  </div>
}
