import SubscriptionRefund from './SubscriptionRefund'
import Tariffs from './Tariffs'
import PaymentOrderDetails from './PaymentOrderDetails'
import PaymentReviewStatus from './PaymentReviewStatus'
import RefundHistory from './RefundHistory'
import RefundPreview from './RefundPreview'
import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

export default function OrganizationPayments({ api, client, organizationId }) {
 return <PaymentList key={organizationId} api={api} client={client} organizationId={organizationId} />
}
const paymentLabels = { not_created: 'Платёж не создан', pending: 'Ожидает оплаты', waiting_for_capture: 'Ожидает подтверждения списания', succeeded: 'Оплачен', canceled: 'Отменён' }
const orderLabels = { reserved: 'Подготовлен', sending: 'Отправляется', review: 'Требует проверки', finished: 'Обработка завершена' }
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value) / 100)
function PaymentList({ api, client, organizationId }) {
 const [version, setVersion] = useState(null)
 const versionTrigger = useRef(null)
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
   const result = await api.payments(organizationId, cursor)
   if (request === generation.current) setPage(result)
  } catch (failure) {
   if (request === generation.current) setError(adminError(failure))
  } finally {
   running.current = false
   if (request === generation.current) setBusy(false)
  }
 }
 return <><div hidden={!!version}><section aria-label="Платежи организации">
  <h3>Платежи</h3>
  <p>Тестовая среда (sandbox). Реальные деньги не списываются. Здесь показаны денежные заказы; покупки со скидкой 100% без платежа в этот список не входят.</p>
  <p>Время указано по часовому поясу устройства. Возврат сам по себе не изменяет доступ.</p>
  <button type="button" disabled={busy} onClick={() => load()}>Загрузить платежи</button>
  {busy && <p role="status">Загружаем платежи…</p>}
  {error && <p role="alert">{error}</p>}
  {page && <>
   {!page.items.length && <p>Тестовых платежей нет.</p>}
   <ul>{page.items.map(item => <li key={item.id}>
    <strong>{money(item.amount_minor)} · {paymentLabels[item.payment_status] || 'Неизвестный статус оплаты'}</strong>
    <PaymentOrderDetails item={item} onOpen={client ? event => { versionTrigger.current = event.currentTarget; setVersion(item.plan_version_id) } : null} />
    <details><summary>Технические данные</summary><small>Заказ: {item.id}</small>
    {item.payment_id && <small>Платёж: {item.payment_id}</small>}</details>
    <p>Заказ: {item.fulfillment_state === 'deferred' && !item.payment_requires_review ? 'Ожидает активации периода' : (orderLabels[item.order_state] || 'Неизвестный статус заказа')}.</p>
    <p>Создан: {new Date(item.created_at).toLocaleString('ru-RU')}.</p>
    <p>Возвращено: {money(item.refunded_minor)}. Ожидает возврата: {money(item.refund_pending_minor)}.</p>
    <p>Возвраты на проверке: {money(item.refund_review_minor)}.</p>
    <PaymentReviewStatus item={item} />
    {client && import.meta.env.VITE_ADMIN_SUBSCRIPTION_REFUNDS === 'true' && item.payment_status === 'succeeded' && !item.payment_requires_review && <SubscriptionRefund key={organizationId+':'+item.id} api={api} client={client} organizationId={organizationId} orderId={item.id} />}
    {item.payment_status === 'succeeded' && !item.payment_requires_review && <RefundPreview api={api} client={client} organizationId={organizationId} orderId={item.id} />}
    {client && import.meta.env.VITE_ADMIN_SANDBOX_REFUNDS === 'true' && <RefundHistory api={api} client={client} organizationId={organizationId} orderId={item.id} />}
   </li>)}</ul>
   {page.next_cursor && <button type="button" disabled={busy} onClick={() => load(page.next_cursor)}>Следующая страница платежей</button>}
  </>}
 </section></div>{version && <section aria-label="Тариф заказа"><button type="button" onClick={() => { setVersion(null); requestAnimationFrame(() => versionTrigger.current?.focus()) }}>К платежам</button><Tariffs key={version} client={client} initialVersionId={version} /></section>}</>
}
