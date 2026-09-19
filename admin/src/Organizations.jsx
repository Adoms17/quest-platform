import { useEffect, useMemo, useRef, useState } from 'react'
import { adminError, createAdminApi } from './api'

export default function Organizations({ client }) {
  const api = useMemo(() => createAdminApi(client), [client])
  const generation = useRef(0)
  const cardElement = useRef(null)
  const cardTrigger = useRef(null)
  const [page, setPage] = useState({ items: [], next_cursor: null })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [card, setCard] = useState(null)
  useEffect(() => () => { generation.current += 1 }, [])
  useEffect(() => { if (card) cardElement.current?.focus() }, [card])
  function closeCard() {
    setCard(null)
    if (cardTrigger.current?.isConnected) cardTrigger.current.focus()
  }
  async function run(operation, apply) {
    const request = ++generation.current
    setBusy(true); setError(''); setCard(null)
    try {
      const value = await operation()
      if (generation.current === request) apply(value)
    } catch (failure) {
      if (generation.current === request) { setPage({ items: [], next_cursor: null }); setError(adminError(failure)) }
    } finally { if (generation.current === request) setBusy(false) }
  }
  function search(event) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('query').trim()
    setQuery(value)
    setPage({ items: [], next_cursor: null })
    run(() => api.search(value), setPage)
  }
  return <section><h1>Организации</h1><p>Доступны только организации в области вашей системной роли.</p>
    <form className="search" onSubmit={search}><label>Название или ID организации<input name="query" maxLength={160} type="search" /></label><button disabled={busy}>Найти</button></form>
    {busy && <p role="status">Загружаем…</p>}{error && <p role="alert">{error}</p>}
    <ul>{page.items.map(item => <li key={item.id}><button disabled={busy} onClick={event => { cardTrigger.current = event.currentTarget; run(() => api.organization(item.id), setCard) }}>{item.name}</button><small>{item.id}</small></li>)}</ul>
    {!busy && !error && page.items.length === 0 && <p>Список пуст. Выполните поиск; пустой запрос покажет все доступные организации.</p>}
    {page.next_cursor && <button disabled={busy} onClick={() => run(() => api.search(query, page.next_cursor), setPage)}>Следующая страница</button>}
    {card && <article ref={cardElement} tabIndex={-1} aria-label="Карточка организации"><h2>{card.name}</h2><dl><dt>ID</dt><dd>{card.id}</dd><dt>Создана</dt><dd>{new Date(card.created_at).toLocaleString('ru-RU')}</dd></dl><button onClick={closeCard}>Закрыть карточку</button></article>}
  </section>
}
