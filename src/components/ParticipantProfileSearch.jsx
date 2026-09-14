import { useEffect, useState } from 'react'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'
import { getParticipantProfileCard } from '../services/peopleCatalogApi'

export default function ParticipantProfileSearch({ actorId, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState(null)
  const catalog = usePeopleCatalog(open ? actorId : null, 'profiles', search, revision)
  useEffect(() => {
    const controller = new AbortController()
    if (value) getParticipantProfileCard(value, controller.signal).then(profile => {
      if (!controller.signal.aborted) setSelected({ id: value, name: profile.can_participate ? profile.display_name : null })
    }).catch(() => { if (!controller.signal.aborted) setSelected({ id: value, name: null }) })
    return () => controller.abort()
  }, [actorId, value, revision])
  const caption = !value ? 'Выберите участника' : selected?.id !== value ? 'Загрузка профиля…' : selected.name || 'Профиль недоступен'
  return <section className="space-y-3" aria-label="Выбор участника истории">
    <p className="break-words font-medium">Участник: {caption}</p>
    <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className="py-2 text-blue-700">{open ? 'Закрыть поиск' : 'Выбрать участника'}</button>
    {open && <>
      <label className="block"><span className="mb-1 block font-medium">Найти участника</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
      {catalog.loading && <p role="status">Загрузка профилей…</p>}
      {catalog.error && <div role="alert"><p>Не удалось загрузить профили.</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить поиск</button></div>}
      {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Участники не найдены.</p>}
      <ul className="space-y-2">{catalog.items.map(profile => <li key={profile.id}><button type="button" disabled={!profile.can_participate} aria-pressed={profile.id === value} onClick={() => { onChange(profile.id); setOpen(false) }} className="w-full break-words rounded-lg border p-3 text-left text-blue-700 disabled:text-gray-500">{profile.display_name}<span className="block text-sm text-gray-500">{!profile.can_participate ? 'Контроль приостановлен' : profile.relationship === 'self' ? 'Мой профиль' : 'Доступный профиль'}</span></button></li>)}</ul>
      {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="py-3 text-blue-700">Показать ещё участников</button>}
    </>}
  </section>
}
