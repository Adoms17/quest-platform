import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuestResultsCatalog } from '../hooks/useQuestResultsCatalog'
import QuestResultTasks from '../components/QuestResultTasks'
import QuestResultsMaintenanceAccess from '../components/QuestResultsMaintenanceAccess'

const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—'
const confidence = { trusted: 'Серверное', bounded: 'Ограниченное', reported: 'С устройства' }
export default function QuestStats({ session }) {
  const { id } = useParams()
  return <Results key={`${session?.user?.id}:${id}`} questId={id} actorId={session?.user?.id} />
}
function Results({ questId, actorId }) {
  const [search, setSearch] = useState(''), [completion, setCompletion] = useState('all'), [revision, setRevision] = useState(0)
  const [sort, setSort] = useState('newest')
  const catalog = useQuestResultsCatalog(actorId, questId, completion, search, revision, sort)
  const refresh = () => setRevision(n => n + 1)
  return <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 [overflow-wrap:anywhere] sm:px-6">
    <h1 className="text-2xl font-bold">Результаты квеста</h1>
    <p className="text-sm text-gray-600">Показаны данные, поступившие на сервер; офлайн-ответы могут ещё ожидать отправки. Незавершённое прохождение не означает, что участник сейчас онлайн.</p>
    <label className="block">Найти участника или аккаунт<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
    <label className="block">Завершение<select value={completion} onChange={event => setCompletion(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="all">Все прохождения</option><option value="finished">Завершённые</option><option value="unfinished">Незавершённые</option></select></label>
    <label className="block">Порядок<select value={sort} onChange={event => setSort(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="newest">Сначала новые</option><option value="oldest">Сначала ранние</option><option value="success">Успешность: по убыванию</option><option value="time">Серверное время: по возрастанию</option><option value="name">По имени участника</option></select></label>
    {sort === 'time' && <p className="text-sm text-gray-600">Сначала завершённые прохождения с серверным доверием ко времени. Остальные — в конце; время с устройства не сравнивается.</p>}
    <p className="text-sm text-gray-600">Неизвестные значения — в конце. Если результаты изменились во время просмотра, обновите список.</p>
    {catalog.loading && <p role="status">Загрузка результатов…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет права просмотра результатов этого квеста.' : 'Не удалось загрузить результаты.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : refresh()} className="py-3 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Прохождения не найдены. Попробуйте изменить поиск или фильтр.</p>}
    <section aria-label="Прохождения" className="space-y-3">{catalog.items.map(item => <article key={item.id} className="min-w-0 space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{item.participant_display_name || item.executor_username || 'Участник'}</h2>
      {item.executor_username && <p className="text-sm text-gray-600">Аккаунт: {item.executor_username}</p>}
      <p>{item.finished_at ? 'Завершено' : 'Не завершено'} · успешно {item.completed_tasks ?? 0} из {item.total_tasks ?? '—'} · {item.percent_success == null ? '—' : Math.round(item.percent_success)}%</p>
      <p className="text-sm text-gray-600">Начало: {date(item.started_at)}<br />Завершение: {date(item.finished_at)}</p>
      <p className="text-sm">Неуспешных заданий: {item.failed_tasks ?? 0} · попыток ответа: {item.total_attempts ?? 0}</p>
      <p className="text-sm text-gray-600">Серверное время: {item.trusted_time_seconds ?? '—'} сек · с устройства: {item.reported_offline_time_seconds ?? '—'} сек<br />Доверие ко времени: {confidence[item.timing_confidence] || 'Не определено'}</p>
      <QuestResultTasks questId={questId} attemptId={item.id} />
    </article>)}</section>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">{catalog.moreLoading ? 'Загрузка…' : 'Показать ещё'}</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={refresh} className="block py-3 text-blue-700">Обновить результаты</button>
    {!catalog.denied && <QuestResultsMaintenanceAccess actorId={actorId} questId={questId} revision={revision} onRefresh={refresh} />}
  </div>
}
