import { useState } from 'react'

// Порционный вывод разрешённого набора; не подменяет серверную пагинацию.
export default function PeopleList({ items, label, getSearchText, children, className = 'space-y-3' }) {
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(25)
  const query = search.trim().toLocaleLowerCase('ru')
  const matches = items.filter(item => getSearchText(item).toLocaleLowerCase('ru').includes(query))

  return <div className="min-w-0">
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input type="search" value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setLimit(25) }} className="w-full rounded-lg border bg-white p-3" />
    </label>
    <p className="mb-3 text-sm text-gray-500" role="status">{matches.length ? `Показано ${Math.min(limit, matches.length)} из ${matches.length}` : query ? 'Ничего не найдено. Попробуйте другое имя или название.' : 'Пока нет записей.'}</p>
    <div className={className}>{matches.slice(0, limit).map(children)}</div>
    {matches.length > limit && <button type="button" onClick={() => setLimit(current => current + 25)} className="mt-4 rounded-lg border bg-white px-4 py-3 text-blue-700">Показать ещё</button>}
  </div>
}
