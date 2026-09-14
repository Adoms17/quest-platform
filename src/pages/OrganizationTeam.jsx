import { lazy, Suspense, useEffect, useState } from 'react'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import OrganizationInvitationActions from '../components/OrganizationInvitationActions'
import { loadLocalSecretLinks } from '../services/localSecretLinks'
import OrganizationMemberActions from '../components/OrganizationMemberActions'
import { useTeamCatalog } from '../hooks/useTeamCatalog'
const Invite = lazy(() => import('../components/OrganizationInvite'))
const Audit = lazy(() => import('../components/OrganizationAudit'))
const labels = { active: 'Активен', invited: 'Приглашён', suspended: 'Приостановлен', revoked: 'Доступ отозван', pending: 'Ожидает принятия', accepted: 'Принято', expired: 'Истекло' }
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—'
export default function OrganizationTeam({ session }) {
  const { currentOrganization, loadingOrganizations, organizationError, reloadOrganizations } = useOrganization()
  if (loadingOrganizations) return <p className="p-4" role="status">Загрузка организации…</p>
  if (organizationError) return <div className="p-4" role="alert"><p>Не удалось загрузить организации.</p><button type="button" onClick={() => void reloadOrganizations()} className="py-3 text-blue-700">Повторить</button></div>
  if (!currentOrganization) return <p className="p-4">Нет доступной организации.</p>
  const canRead = hasOrganizationPermission(currentOrganization, 'members.read')
  const canManage = hasOrganizationPermission(currentOrganization, 'members.manage')
  if (!canRead && !canManage) return <p className="p-4">Нет доступа к команде организации.</p>
  return <Team key={`${session?.user?.id}:${currentOrganization.id}:${canRead}:${canManage}`} organization={currentOrganization} actorId={session?.user?.id} canRead={canRead} canManage={canManage} />
}
function Team({ organization, actorId, canRead, canManage }) {
  const [kind, setKind] = useState(canRead ? 'members' : 'invitations')
  const [inviting, setInviting] = useState(false)
  const [revision, setRevision] = useState(0)
  if (inviting) return <div className="mx-auto max-w-3xl space-y-4 p-4 [overflow-wrap:anywhere]"><p className="font-medium">{organization.name}</p><Suspense fallback={<p role="status">Загрузка формы…</p>}><Invite organizationId={organization.id} onClose={() => { setInviting(false); setKind('invitations'); setRevision(n => n + 1) }} onCheck={() => { setInviting(false); setKind('invitations'); setRevision(n => n + 1) }} /></Suspense></div>
  return <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 [overflow-wrap:anywhere] sm:px-6">
    <header><p className="text-sm text-gray-600">{organization.name}</p><h1 className="text-2xl font-bold">Команда организации</h1></header>
    <div role="group" aria-label="Списки команды" className="flex flex-wrap gap-2">
      {canRead && <button type="button" aria-pressed={kind === 'members'} onClick={() => setKind('members')} className={`rounded-lg border px-4 py-3 ${kind === 'members' ? 'bg-blue-600 text-white' : ''}`}>Сотрудники</button>}
      {canManage && <button type="button" aria-pressed={kind === 'invitations'} onClick={() => setKind('invitations')} className={`rounded-lg border px-4 py-3 ${kind === 'invitations' ? 'bg-blue-600 text-white' : ''}`}>Приглашения</button>}
      {canManage && <button type="button" aria-pressed={kind === 'audit'} onClick={() => setKind('audit')} className={`rounded-lg border px-4 py-3 ${kind === 'audit' ? 'bg-blue-600 text-white' : ''}`}>Журнал</button>}
    </div>
    {canManage && <button type="button" onClick={() => setInviting(true)} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Пригласить сотрудника</button>}
    {kind === 'audit' ? <Suspense fallback={<p role="status">Загрузка журнала…</p>}><Audit organizationId={organization.id} actorId={actorId} /></Suspense> : <Catalog key={`${kind}:${revision}`} organizationId={organization.id} actorId={actorId} kind={kind} canManage={canManage} />}
  </div>
}
function Catalog({ organizationId, actorId, kind, canManage }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState(kind === 'members' ? 'active' : 'pending'), [revision, setRevision] = useState(0)
  const [links, setLinks] = useState({})
  useEffect(() => {
    let active = true
    if (kind === 'invitations') loadLocalSecretLinks(`organization:${organizationId}`).then(data => { if (active) setLinks(data) })
    return () => { active = false }
  }, [organizationId, kind, revision])
  const { reloadOrganizations } = useOrganization()
  const catalog = useTeamCatalog(actorId, organizationId, kind, status, search, revision)
  const refresh = () => setRevision(n => n + 1)
  return <section aria-label="Каталог команды" className="space-y-4">
    <label className="block">{kind === 'members' ? 'Найти по имени или email' : 'Найти приглашение по email'}<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
    <label className="block">Статус<select value={status} onChange={event => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="all">Все статусы</option>{(kind === 'members' ? ['active','invited','suspended','revoked'] : ['pending','accepted','expired','revoked']).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
    <p className="text-sm text-gray-500">Новые записи сверху. {kind === 'members' ? 'Для просмотра прежних сотрудников измените статус.' : 'Просроченные приглашения находятся в статусе «Истекло».'}</p>
    {catalog.loading && <p role="status">Загрузка списка…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет права просмотра этого списка.' : 'Не удалось загрузить список.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : refresh()} className="py-3 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Записи не найдены. Попробуйте изменить поиск или статус.</p>}
    {catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{item.username || item.email || 'Сотрудник'}</h2>
      {item.username && <p className="text-sm text-gray-600">{item.email}</p>}
      <p>{item.roles?.map(role => role.name).join(', ') || 'Без роли'}</p>
      <p>{labels[item.display_status || item.status] || 'Статус недоступен'}</p>
      <p className="text-sm text-gray-600">{kind === 'members' ? 'Запись создана' : 'Создано'} {date(item.created_at)}{kind === 'invitations' && <><br />Действует до {date(item.expires_at)}</>}</p>
      {kind === 'invitations' && canManage && <OrganizationInvitationActions key={`${item.id}:${revision}`} invitation={item} link={links[item.id]} onRefresh={refresh} />}
      {kind === 'members' && canManage && <OrganizationMemberActions key={`${item.id}:${revision}`} member={item} onRefresh={() => { refresh(); void reloadOrganizations() }} />}
    </article>)}
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={refresh} className="block py-3 text-blue-700">Обновить список</button>
  </section>
}
