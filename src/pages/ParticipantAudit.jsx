import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'

export default function ParticipantAudit({ session }) {
  const { profileId } = useParams()
  return <Audit key={`${session?.user?.id}:${profileId}`} actorId={session?.user?.id} profileId={profileId} />
}
function Audit({ actorId, profileId }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const catalog = usePeopleCatalog(actorId, 'audit', search, revision, profileId)
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}`} className="inline-block py-2 text-blue-700">К карточке участника</Link>
    <h1 className="text-2xl font-bold">Журнал управления профилем</h1>
    <p className="text-gray-600">Владельцу доступны события профиля, остальным — только действия своего аккаунта. Новые события показаны первыми.</p>
    <label className="block"><span className="mb-1 block font-medium">Найти по имени автора или участника действия</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
    {catalog.loading && <p role="status">Загрузка событий…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет доступа к журналу этого профиля.' : 'Не удалось загрузить события.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">События не найдены.</p>}
    <div className="space-y-3">{catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{({ 'supervision.added':'Добавлен контролирующий взрослый','supervision.status_changed':'Изменён статус контроля','group.member_added':'Участник добавлен в группу','group.member_role_changed':'Изменена роль в группе','group.member_removed':'Участник удалён из группы','invitation.created':'Создано приглашение','invitation.accepted':'Приглашение принято','invitation.revoked':'Приглашение отозвано' })[item.action] || 'Изменение профиля'}</h2>
      <p className="text-sm text-gray-600">Автор: {item.actor_username || 'Системное действие'}</p>
      {item.subject_username && <p className="text-sm text-gray-600">Участник действия: {item.subject_username}</p>}
      <p className="text-sm text-gray-500">{new Date(item.created_at).toLocaleString('ru-RU')}</p>
    </article>)}</div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => setRevision(n => n + 1)} className="block py-3 text-blue-700">Обновить журнал</button>
    <Link to="/participants/group/archive" className="block py-3 text-blue-700">Архив приглашений и действий</Link>
  </div>
}
