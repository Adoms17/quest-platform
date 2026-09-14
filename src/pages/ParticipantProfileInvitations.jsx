import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'
import InvitationQrCode from '../components/InvitationQrCode'
import { loadLocalSecretLinks } from '../services/localSecretLinks'

export default function ParticipantProfileInvitations({ session }) {
  const { profileId } = useParams()
  return <Invitations key={`${session?.user?.id}:${profileId}`} actorId={session?.user?.id} profileId={profileId} />
}
function Invitations({ actorId, profileId }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [links, setLinks] = useState({})
  const [message, setMessage] = useState('')
  const catalog = usePeopleCatalog(actorId, 'profile-invitations', search, revision, profileId)
  useEffect(() => {
    let active = true
    loadLocalSecretLinks('participant-profile-invitations').then(value => { if (active) setLinks(value) })
    return () => { active = false }
  }, [revision])
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}`} className="inline-block py-2 text-blue-700">К карточке участника</Link>
    <Link to="/participants/group/archive" className="block py-2 text-blue-700">К архиву приглашений и действий</Link>
    <h1 className="text-2xl font-bold">Мои приглашения</h1>
    <p className="text-gray-600">Приглашения, созданные вами для выбранного профиля.</p>
    <label className="block"><span className="mb-1 block font-medium">Найти по email</span><input type="search" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setMessage('') }} className="w-full rounded-lg border p-3" /></label>
    {catalog.loading && <p role="status">Загрузка приглашений…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет доступа к приглашениям этого профиля.' : 'Не удалось загрузить приглашения.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Приглашения не найдены.</p>}
    {message && <p role="status">{message}</p>}
    <div className="space-y-3">{catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="break-all font-semibold">{item.email}</h2>
      <p className="text-sm text-gray-600">{item.invitation_kind === 'claim' ? 'Отдельный аккаунт' : 'Контролирующий взрослый'}</p>
      <p>{({ pending: 'Ожидает принятия', accepted: 'Принято', revoked: 'Отозвано', expired: 'Срок истёк' })[item.display_status] || 'Статус недоступен'}</p>
      <p className="text-sm text-gray-500">Срок: {new Date(item.expires_at).toLocaleString('ru-RU')}</p>
      {item.display_status === 'pending' && (links[item.id] ? <div className="flex flex-wrap items-center gap-4"><button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(links[item.id]); setMessage('Ссылка скопирована') }
        catch { setMessage('Не удалось скопировать ссылку. Проверьте разрешение браузера на буфер обмена.') }
      }} className="py-2 text-blue-700">Копировать ссылку</button><InvitationQrCode value={links[item.id]} label="к профилю участника" /></div> : <p className="text-sm text-gray-500">Ссылка не сохранена на этом устройстве.</p>)}
    </article>)}</div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => { setMessage(''); setRevision(n => n + 1) }} className="block py-3 text-blue-700">Обновить приглашения</button>
  </div>
}
