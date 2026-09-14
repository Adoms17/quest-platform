import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'

export default function PeopleCatalog({ session }) {
  const [params, setParams] = useSearchParams()
  const [revision, setRevision] = useState(0)
  const kind = params.get('view') === 'groups' ? 'groups' : 'profiles'
  const search = params.get(kind) || ''
  const catalog = usePeopleCatalog(session?.user?.id, kind, search, revision)
  const update = (name, value) => setParams(current => {
    const next = new URLSearchParams(current)
    if (value) next.set(name, value); else next.delete(name)
    return next
  }, { replace: true })

  return <div className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Люди</h1>
    </header>
    {kind === 'profiles' && <Link to="/participants/group/create" className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-white">Добавить участника</Link>}
    {kind === 'groups' && <Link to="/participants/group/create-group" className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-white">Создать группу</Link>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Раздел людей">
      {[['profiles', 'Профили'], ['groups', 'Группы']].map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => update('view', value)} className={`rounded-lg border px-4 py-3 ${kind === value ? 'bg-blue-600 text-white' : 'bg-white'}`}>{label}</button>)}
    </div>
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{kind === 'profiles' ? 'Найти профиль по имени' : 'Найти группу по названию'}</span>
      <input type="search" maxLength={200} value={search} onChange={event => update(kind, event.target.value)} className="w-full rounded-lg border bg-white p-3" />
    </label>
    {catalog.loading && <p role="status">Загрузка списка…</p>}
    {catalog.error && <div role="alert" className="rounded-lg border bg-white p-4">
      <p>{catalog.denied ? 'Доступ к списку недоступен. Обновите список для проверки прав.' : 'Не удалось загрузить список. Проверьте соединение и повторите.'}</p>
      <button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(value => value + 1)} className="mt-2 py-2 text-blue-700">Повторить</button>
    </div>}
    {!catalog.loading && !catalog.error && <p role="status" className="text-sm text-gray-500">{catalog.items.length ? `Загружено: ${catalog.items.length}` : search ? 'Ничего не найдено. Попробуйте другое имя или название.' : 'Пока нет доступных записей.'}</p>}
    <div className="space-y-3">
      {catalog.items.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{kind === 'groups' ? item.group_name : item.display_name}</h2>
          <p className="mt-1 text-sm text-gray-500">{kind === 'groups' ? item.can_manage ? 'Можно управлять' : 'Только просмотр' : item.relationship === 'self' ? 'Мой профиль' : item.can_participate ? 'Можно проходить квесты' : 'Контроль приостановлен'}</p>
        </div>
        <Link aria-label={`${kind === 'groups' ? 'Состав группы' : 'Открыть профиль'}: ${item.group_name || item.display_name}`} to={kind === 'groups' ? `/participants/group/${encodeURIComponent(item.id)}` : `/participants/group/profiles/${encodeURIComponent(item.id)}`} className="rounded-lg border px-3 py-3 text-blue-700">{kind === 'groups' ? 'Состав' : 'Открыть'}</Link>
      </article>)}
    </div>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border bg-white px-4 py-3 text-blue-700 disabled:opacity-50">{catalog.moreLoading ? 'Загрузка…' : 'Показать ещё'}</button>}
    <Link to="/participants/group/supervision" className="block py-3 text-blue-700">Мои связи контроля</Link>
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={() => setRevision(value => value + 1)} className="block py-3 text-blue-700 disabled:opacity-50">Обновить список</button>
    <Link to="/participants/group/archive" className="block py-3 text-blue-700">Архив приглашений и действий</Link>
  </div>
}
