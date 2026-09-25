import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

export default function OrganizationQuests({ api, organizationId }) {
  return <QuestList key={organizationId} api={api} organizationId={organizationId} />
}
function QuestList({ api, organizationId }) {
  const [page, setPage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState({ search: '', status: 'all' })
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  async function load(filters, cursor = null) {
    const request = ++generation.current
    setBusy(true); setError(''); setPage(null); setFilter(filters)
    try {
      const result = await api.quests(organizationId, filters.search, filters.status, cursor)
      if (request === generation.current) setPage(result)
    } catch (failure) {
      if (request === generation.current) setError(adminError(failure))
    } finally { if (request === generation.current) setBusy(false) }
  }
  function search(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    load({ search: form.get('search').trim(), status: form.get('status') })
  }
  const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : 'Не указана'
  return <section aria-label="Квесты организации">
    <p>Реестр квестов без содержимого заданий и персональных данных участников.</p>
    <form onSubmit={search}>
      <label>Название квеста<input name="search" maxLength={200} type="search" /></label>
      <label>Доступность<select name="status"><option value="all">Все</option><option value="open">Открытые</option><option value="closed">Закрытые</option></select></label>
      <button disabled={busy}>Найти квесты</button>
    </form>
    {busy && <p role="status">Загружаем квесты…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => load(filter)}>Повторить загрузку квестов</button></>}
    {page && <>
      <p>Всего в организации: {page.summary.total}. Открытых: {page.summary.open}. Закрытых: {page.summary.closed}.</p>
      {!page.items.length && <p>По выбранным условиям квестов нет.</p>}
      <ul>{page.items.map(item => <li key={item.id}>
        <h3>{item.title}</h3><p>{item.is_open ? 'Открыт' : 'Закрыт'} · {item.is_public ? 'Публичный' : 'Приватный'}</p>
        <p>Создан: {date(item.created_at)}</p>
        {item.start_at && <p>Начало: {date(item.start_at)}</p>}
        {item.end_at && <p>Окончание: {date(item.end_at)}</p>}
      </li>)}</ul>
      {page.next_cursor && <button disabled={busy} onClick={() => load(filter, page.next_cursor)}>Следующая страница квестов</button>}
    </>}
  </section>
}