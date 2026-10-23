import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useParticipantDashboard } from '../hooks/useParticipantDashboard'
import { useParticipantCatalog } from '../hooks/useParticipantCatalog'
import { buildParticipantQuestRows, downloadParticipantQuest } from '../services/participantDashboard'
import { getUserErrorMessage } from '../services/userErrorMessage'
import { isAbortError } from '../services/requestCancellation'
import ParticipantQuestProfilePicker from './ParticipantQuestProfilePicker'
import ParticipantResume from './ParticipantResume'
import AppIcon from './AppIcon'
import PrepareOfflineStart from './PrepareOfflineStart'

let rememberedProfile = null
export default function ParticipantDashboard({ userId, home, requestedProfile = '' }) {
  const [params] = useSearchParams()
  const { data, loading, error, refresh } = useParticipantDashboard(userId)
  const [chosenProfile, setChosenProfile] = useState(() => requestedProfile || (rememberedProfile?.userId === userId ? rememberedProfile.profileId : ''))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(() => params.get('view') === 'started' ? 'started' : 'all')
  const [limit, setLimit] = useState(25)
  const [downloading, setDownloading] = useState(null)
  const downloadController = useRef(null)
  const profiles = data?.profiles || []
  const profileId = profiles.some(p => p.participant_profile_id === chosenProfile) ? chosenProfile
    : chosenProfile ? '' : profiles.find(p => p.relationship === 'self')?.participant_profile_id || (profiles.length === 1 ? profiles[0].participant_profile_id : '')
  const profileName = profiles.find(p => p.participant_profile_id === profileId)?.display_name || ''
  const catalog = useParticipantCatalog(profileId, search, filter === 'started' ? 'started' : 'all', Boolean(data && !data.offline && filter !== 'ready'), data, 25)
  const resume = useParticipantCatalog(profileId, '', 'started', Boolean(data && !data.offline && home), data, 4)
  const rows = useMemo(() => data && !catalog.denied ? buildParticipantQuestRows({ ...data, quests: catalog.items.map(q => ({ ...q, quest_id: q.id, participants: [{ participant_profile_id: profileId }] })) }, profileId) : [], [data, profileId, catalog.items, catalog.denied])
  const started = useMemo(() => data && !resume.denied ? buildParticipantQuestRows({ ...data, quests: resume.items.map(q => ({ ...q, quest_id: q.id, participants: [{ participant_profile_id: profileId }] })) }, profileId).filter(row => row.attempt).sort((a, b) => String(b.attempt.updatedAt || '').localeCompare(String(a.attempt.updatedAt || ''))) : [], [data, profileId, resume.items, resume.denied])
  const shown = rows.filter(row => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter !== 'ready' || row.readiness.ready) && (filter !== 'started' || (row.attempt && (row.active_attempt_id || data?.offline || !row.attempt.serverId))))
  if (!data?.offline && filter !== 'ready') {
    const rank = new Map(catalog.items.map((row, index) => [row.id, index]))
    shown.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  useEffect(() => () => downloadController.current?.abort(), [profileId])
  const chooseProfile = value => {
    downloadController.current?.abort()
    setDownloading(null); setChosenProfile(value); setSearch(''); setFilter('all'); setLimit(25)
    rememberedProfile = { userId, profileId: value }
  }
  const download = async row => {
    if (downloadController.current && !downloadController.current.signal.aborted) return
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(row.id)
    try {
      const result = await downloadParticipantQuest(row.id, profileId, controller.signal)
      if (!controller.signal.aborted) {
        toast.success(result.offlineMediaFailures?.length ? 'Пакет сохранён с предупреждениями. Часть материалов недоступна офлайн.' : 'Квест сохранён для выбранного участника')
        refresh()
      }
    } catch (error) {
      if (!isAbortError(error, controller.signal)) toast.error(getUserErrorMessage(error, 'Не удалось скачать квест. Прежний пакет сохранён.'))
    } finally {
      if (downloadController.current === controller) { downloadController.current = null; setDownloading(null) }
    }
  }
  return <div className="participant-dashboard">
    {home && <h1 className="sr-only">Главная</h1>}
    {error && <div role="alert" className="mb-5 rounded-xl bg-amber-50 p-4">Не удалось проверить доступные квесты. <button onClick={refresh} className="text-blue-700 underline">Повторить</button><p><Link to="/downloads">Сохранённые материалы и ожидающие события</Link></p></div>}
    {data && <>
      <ParticipantQuestProfilePicker profiles={profiles} value={profileId} onChange={chooseProfile} />
      {data.offline && <p role="status" className="mb-4 text-sm text-amber-800">Нет соединения с сервером. Показаны сохранённые материалы; доступ проверяется по локальному сроку.</p>}
      {home && <ParticipantResume key={`${profileId}:${data.offline}`} rows={started} offline={data.offline} profileName={profileName} />}
      {data.pending.length > 0 && <Link to="/downloads" className="participant-pending"><span className="flex items-center gap-3"><AppIcon name="clock" />Ожидают отправки: {data.pending.filter(item => item.reviewState !== 'needs_review').length}</span><small>События всех участников этого аккаунта. Сохранены на устройстве. {data.pending.some(item => item.reviewState === 'needs_review') && 'Часть результатов сохранена на сервере и требует проверки организатора.'}</small></Link>}
    </>}
    <Link className="participant-code" to="/access/code"><AppIcon name="key" />Ввести код квеста</Link>
    <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
      {home ? <h2 className="text-2xl font-bold">Мои квесты</h2> : <h1 className="text-2xl font-bold">Мои квесты</h1>}
      <Link className="text-blue-700" to="/downloads">Хранилище</Link>
    </div>
    <label className="quest-search"><AppIcon name="search" /><input type="search" aria-label="Найти мой квест по названию" placeholder="Найти квест" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setLimit(25) }} /></label>
    <div className="quest-filters" aria-label="Фильтры моих квестов">{[['all', 'Все'], ['started', 'В процессе'], ['ready', 'Готовы офлайн']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setLimit(25) }}>{label}</button>)}</div>
    {(catalog.error || resume.error) && <p role="alert" className="my-3 text-amber-800">Не удалось обновить серверный каталог. Сохранённые материалы остаются на устройстве. <button onClick={refresh} className="underline">Повторить запрос</button></p>}
    {(loading || catalog.loading) && <p role="status" className="my-4 text-slate-600">Обновляем квесты и состояние устройства…</p>}
    {data && !profileId && <p className="my-4">Выберите участника, чтобы увидеть его квесты.</p>}
    {data && profileId && !shown.length && !catalog.loading && !catalog.error && <p className="my-4 text-slate-600">{search || filter !== 'all' ? 'По этим условиям квесты не найдены.' : 'Пока нет доступных или сохранённых квестов. Введите код от организатора.'}</p>}
    <ul className="participant-quest-list">{shown.slice(0, limit).map(row => <li key={`${row.id}:${profileId}`}>
      <span className="quest-list-thumbnail"><AppIcon name="map" /></span>
      <div className="participant-quest-summary"><Link className="font-semibold" to={`/play/${row.id}?participant=${encodeURIComponent(profileId)}`}>{row.title}</Link>
        {row.description && <p className="quest-row-description">{row.description}</p>}
        <p className={`participant-readiness is-${row.readiness.key}`}>{row.readiness.text}</p>
        {!row.remote && <p className="text-xs text-slate-600">Сохранён на устройстве. Текущий доступ проверится при открытии.</p>}
        {row.readiness.key === 'partial' && <p className="text-xs text-amber-800">Часть материалов недоступна. Подробности — в хранилище.</p>}
        {!row.attempt && <PrepareOfflineStart questId={row.id} profileId={profileId} userId={userId} />}
        {row.pendingCount > 0 && <p className="text-xs text-amber-800">Сохранённые события: {row.pendingCount}</p>}
      </div>
      {row.readiness.key !== 'ready' && <button className="participant-download" disabled={Boolean(downloading) || data.offline} onClick={() => download(row)}>{downloading === row.id ? 'Скачиваем…' : row.package ? 'Обновить' : 'Скачать'}</button>}
    </li>)}</ul>
    {downloading && <p role="status" className="mt-3 text-sm">Скачиваем материалы. Дождитесь завершения перед уходом со страницы.</p>}
    {(shown.length > limit || catalog.hasMore) && <button className="participant-download mt-4" disabled={catalog.moreLoading} onClick={() => { if (shown.length > limit) setLimit(value => value + 25); else { setLimit(value => value + 25); void catalog.loadMore() } }}>{catalog.moreLoading ? 'Загружаем…' : catalog.error ? 'Повторить загрузку' : 'Показать ещё'}</button>}
    <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm"><Link className="text-blue-700" to={profileId ? `/participants/history?participant=${encodeURIComponent(profileId)}` : '/participants/history'}>История прохождений</Link><button className="text-blue-700" onClick={refresh}>Обновить список</button></div>
  </div>
}
