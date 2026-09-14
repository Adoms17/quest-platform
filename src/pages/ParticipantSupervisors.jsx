import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'
import ParticipantSupervisorAction from '../components/ParticipantSupervisorAction'

export default function ParticipantSupervisors({ session }) {
  const { profileId } = useParams()
  return <Supervisors key={`${session?.user?.id}:${profileId}`} actorId={session?.user?.id} profileId={profileId} />
}
function Supervisors({ actorId, profileId }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const catalog = usePeopleCatalog(actorId, 'supervisors', search, revision, profileId)
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}`} className="inline-block py-2 text-blue-700">К карточке участника</Link>
    <Link to="/participants/group/supervision" className="block py-2 text-blue-700">Мои связи контроля</Link>
    <h1 className="text-2xl font-bold">Контролирующие взрослые</h1>
    <p className="text-gray-600">Владелец профиля видит все связи контроля. Другим взрослым доступна только своя связь. Руководство группой — отдельное основание доступа.</p>
    <label className="block"><span className="mb-1 block font-medium">Найти по имени или email</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
    {catalog.loading && <p role="status">Загрузка связей…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет доступа к связям этого профиля.' : 'Не удалось загрузить связи.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Связи не найдены.</p>}
    <div className="space-y-3">{catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{item.username || 'Пользователь'}{item.is_self ? ' · Вы' : ''}</h2>
      <p className="break-all text-sm text-gray-600">{item.email}</p>
      <p>{({ active: 'Контроль активен', suspended: 'Контроль приостановлен', revoked: 'Доступ отозван' })[item.status] || 'Статус недоступен'}</p>
      <ParticipantSupervisorAction key={`${item.id}:${item.status}:${item.can_restore}:${item.can_revoke}`} profileId={profileId} member={item} onRefresh={() => setRevision(n => n + 1)} />
    </article>)}</div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => setRevision(n => n + 1)} className="block py-3 text-blue-700">Обновить связи</button>
    <Link to="/participants/group/archive" className="block py-3 text-blue-700">Архив приглашений и действий</Link>
  </div>
}
