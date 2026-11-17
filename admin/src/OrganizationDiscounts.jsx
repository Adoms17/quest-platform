import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

export default function OrganizationDiscounts({ api, organizationId }) {
 const [page, setPage] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const generation = useRef(0)
 const running = useRef(false)
 useEffect(() => () => { generation.current += 1 }, [])
 async function load(cursor = null) {
  if (running.current) return
  running.current = true
  const request = ++generation.current
  setBusy(true); setError(''); setPage(null)
  try {
   const result = await api.discounts(organizationId, cursor)
   if (request === generation.current) setPage(result)
  } catch (failure) {
   if (request === generation.current) setError(adminError(failure))
  } finally {
   running.current = false
   if (request === generation.current) setBusy(false)
  }
 }
 return <section aria-label="Промокоды организации">
  <h3>Промокоды</h3>
  <p>Условия персональных скидок. Значения кодов повторно не отображаются. Время указано по часовому поясу устройства.</p>
  <button type="button" disabled={busy} onClick={() => load()}>Загрузить промокоды</button>
  {busy && <p role="status">Загружаем промокоды…</p>}
  {error && <p role="alert">{error}</p>}
  {page && <>
   {!page.items.length && <p>Промокодов нет.</p>}
   <ul>{page.items.map(item => <li key={item.id}>
    <strong>{({ pro: 'Pro', business: 'Business' })[item.plan_key] || item.plan_key} · скидка {item.discount_bps / 100}%</strong>
    <small>ID: {item.id}</small>
    <p>Льготных периодов: {item.eligible_periods}, каждый по {item.period_months} мес.</p>
    <p>Использовано: {item.consumed_periods}. Зарезервировано: {item.reserved_periods}. Осталось: {item.remaining_periods}.</p>
    <p>{item.activation_expired ? 'Срок активации истёк' : 'Активировать до'}: {new Date(item.activate_before).toLocaleString('ru-RU')}.</p>
    <small>Создан: {new Date(item.created_at).toLocaleString('ru-RU')}</small>
   </li>)}</ul>
   {page.next_cursor && <button type="button" disabled={busy} onClick={() => load(page.next_cursor)}>Следующая страница промокодов</button>}
  </>}
 </section>
}