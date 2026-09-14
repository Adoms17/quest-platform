import { useState } from 'react'
import { usePeopleCatalog } from '../hooks/usePeopleCatalog'

export default function ParticipantGroupPicker({ userId, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const catalog = usePeopleCatalog(open ? userId : null, 'groups', search, revision)
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Группа участника">
    <h2 className="font-semibold">Группа — необязательно</h2>
    <p className="break-words">{value ? `Выбрана: ${value.group_name}` : 'Без группы'}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className="py-2 text-blue-700">{open ? 'Закрыть выбор группы' : value ? 'Изменить группу' : 'Выбрать группу'}</button>
      {value && <button type="button" onClick={() => onChange(null)} className="py-2 text-blue-700">Убрать группу</button>}
    </div>
    {open && <div className="space-y-3">
      <label className="block"><span className="mb-1 block text-sm font-medium">Найти группу</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border p-3" /></label>
      <p className="text-sm text-gray-500">Выбрать можно группу, которой вы управляете.</p>
      {catalog.loading && <p role="status">Загрузка групп…</p>}
      {catalog.error && <div role="alert"><p>Не удалось загрузить группы.</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : setRevision(n => n + 1)} className="py-2 text-blue-700">Повторить поиск</button></div>}
      {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Группы не найдены.</p>}
      <ul className="space-y-2">{catalog.items.map(group => <li key={group.id}>
        <button type="button" disabled={!group.can_manage} onClick={() => { onChange(group); setOpen(false) }} className="w-full break-words rounded-lg border p-3 text-left text-blue-700 disabled:text-gray-500">
          {group.group_name}{!group.can_manage && <span className="block text-sm">Только просмотр</span>}
        </button>
      </li>)}</ul>
      {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="py-3 text-blue-700 disabled:opacity-50">{catalog.moreLoading ? 'Загрузка…' : 'Показать ещё группы'}</button>}
    </div>}
  </section>
}
