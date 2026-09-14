import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'

export default function ParticipantSupervisionProfiles({ session }) {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const catalog = usePeopleCatalog(session?.user?.id, 'supervision-profiles', search, revision)
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to="/participants/group" className="inline-block py-2 text-blue-700">К списку людей</Link>
    <h1 className="text-2xl font-bold">Мои связи контроля</h1>
    <p className="text-gray-600">Ваши связи с профилями, включая приостановленные и отозванные. Откройте связь, чтобы проверить доступные действия. Восстановление возможно только в предусмотренных условиях.</p>
    <label className="block"><span className="mb-1 block font-medium">Найти профиль по имени</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
    {catalog.loading && <p role="status">Загрузка связей…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет доступа к списку связей.' : 'Не удалось загрузить связи.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Связи не найдены.</p>}
    <div className="space-y-3">{catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{item.display_name}</h2>
      <p>{({ active: 'Контроль активен', suspended: 'Контроль приостановлен', revoked: 'Доступ отозван' })[item.supervision_status] || 'Статус недоступен'}</p>
      {item.profile_status !== 'active' && <p className="text-sm text-gray-500">Профиль неактивен.</p>}
      <div className="flex flex-wrap gap-4">
        <Link to={`/participants/group/profiles/${encodeURIComponent(item.id)}/supervisors`} className="inline-block py-3 text-blue-700" aria-label={`Открыть связь: ${item.display_name}`}>Открыть связь</Link>
        <Link to={`/participants/group/profiles/${encodeURIComponent(item.id)}/audit`} className="inline-block py-3 text-blue-700" aria-label={`История управления: ${item.display_name}`}>История управления</Link>
      </div>
    </article>)}</div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => setRevision(n => n + 1)} className="block py-3 text-blue-700">Обновить связи</button>
  </div>
}
