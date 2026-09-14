import ParticipantGroupExit from '../components/ParticipantGroupExit'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'
import ParticipantGroupAddMember from '../components/ParticipantGroupAddMember'
import ParticipantGroupInvite from '../components/ParticipantGroupInvite'
import ParticipantGroupRole from '../components/ParticipantGroupRole'

export default function ParticipantGroupMembers({ session }) {
  const { groupId } = useParams()
  return <GroupMembers key={`${session?.user?.id}:${groupId}`} actorId={session?.user?.id} groupId={groupId} />
}

function GroupMembers({ actorId, groupId }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState('')
  const catalog = usePeopleCatalog(actorId, 'members', search, revision, groupId)
  return <div className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-6">
    <Link to="/participants/group?view=groups" className="inline-block py-2 text-blue-700">К списку групп</Link>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{catalog.group?.name || 'Состав группы'}</h1>
    </header>
    {catalog.group?.can_manage && <Link to={`/participants/group/${encodeURIComponent(groupId)}/invitations`} className="inline-block py-2 text-blue-700">Мои приглашения</Link>}
    {catalog.group?.can_manage && !adding && (inviting ? <ParticipantGroupInvite groupId={groupId} onClose={() => setInviting(false)} /> : <button type="button" onClick={() => setInviting(true)} className="rounded-lg border bg-white px-4 py-3 text-blue-700">Пригласить по email</button>)}
    {message && <p role="status" className="rounded-lg bg-blue-50 p-3">{message}</p>}
    {catalog.group?.can_manage && !inviting && (adding ? <ParticipantGroupAddMember actorId={actorId} groupId={groupId} onClose={() => setAdding(false)} onComplete={name => { setAdding(false); setSearch(''); setRevision(n => n + 1); setMessage(name ? `Участник ${name} в составе группы.` : '') }} /> : <button type="button" onClick={() => { setAdding(true); setMessage('') }} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Добавить в группу</button>)}
    <p className="text-sm text-gray-600">Показаны участники, к профилям которых у вас есть доступ.</p>
    <label className="block"><span className="mb-1 block text-sm font-medium">Найти участника по имени</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border bg-white p-3" /></label>
    {catalog.loading && <p role="status">Загрузка состава…</p>}
    {catalog.error && <div role="alert" className="rounded-lg border bg-white p-4">
      <p>{catalog.denied ? 'Группа недоступна. Возможно, ваши права изменились.' : 'Не удалось загрузить состав группы. Проверьте соединение.'}</p>
      <button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(value => value + 1)} className="mt-2 py-2 text-blue-700">Повторить</button>
    </div>}
    {!catalog.loading && !catalog.error && <p role="status" className="text-sm text-gray-500">{catalog.items.length ? `Загружено: ${catalog.items.length}` : search ? 'Участники не найдены.' : 'Нет доступных профилей в этой группе.'}</p>}
    <div className="space-y-3">{catalog.items.map(member => <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
      <div className="min-w-0 flex-1"><h2 className="font-semibold">{member.display_name}</h2><p className="mt-1 text-sm text-gray-500">{member.is_current_user ? 'Мой профиль · ' : ''}{member.member_role === 'leader' ? 'Руководитель группы' : 'Участник группы'}</p></div>
      <Link to={`/participants/group/profiles/${encodeURIComponent(member.id)}`} aria-label={`Открыть профиль: ${member.display_name}`} className="rounded-lg border px-3 py-3 text-blue-700">Открыть</Link>
      {catalog.group?.can_manage && <ParticipantGroupRole key={`${member.id}:${member.member_role}`} groupId={groupId} member={member} onRefresh={() => { setMessage(''); setRevision(n => n + 1) }} />}
      {catalog.group?.can_manage && <ParticipantGroupExit groupId={groupId} member={member} onRefresh={() => { setMessage('Состав обновляется.'); setRevision(n => n + 1) }} />}
    </article>)}</div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border bg-white px-4 py-3 text-blue-700 disabled:opacity-50">{catalog.moreLoading ? 'Загрузка…' : 'Показать ещё'}</button>}
    {catalog.group?.can_leave && <ParticipantGroupExit groupId={groupId} onRefresh={() => { setMessage('Вы вышли из группы. Состав обновляется.'); setRevision(n => n + 1) }} />}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => setRevision(value => value + 1)} className="block py-3 text-blue-700 disabled:opacity-50">Обновить состав</button>
  </div>
}
