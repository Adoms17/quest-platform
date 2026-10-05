import {isAcceptanceOrganization} from './fiscalAcceptanceApi'
import OrderFiscalReceipts from './OrderFiscalReceipts'
import OrderPurchaseDocuments from './OrderPurchaseDocuments'
import SubscriptionRefund from './SubscriptionRefund'
import Tariffs from './Tariffs'
import PaymentOrderDetails from './PaymentOrderDetails'
import PaymentReviewStatus from './PaymentReviewStatus'
import RefundHistory from './RefundHistory'
import RefundPreview from './RefundPreview'
import { useRef, useState } from 'react'
import { useReadSnapshot } from './useReadSnapshot'
import DeviceDateTime from './DeviceDateTime'

export default function OrganizationPayments({ api, client, organizationId }) {
 return <PaymentList key={organizationId} api={api} client={client} organizationId={organizationId} />
}
const paymentLabels = { not_created: 'Платёж не создан', pending: 'Ожидает оплаты', waiting_for_capture: 'Ожидает подтверждения списания', succeeded: 'Оплачен', canceled: 'Отменён' }
const orderLabels = { reserved: 'Подготовлен', sending: 'Отправляется', review: 'Требует проверки', finished: 'Обработка завершена' }
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value) / 100)
function PaymentList({ api, client, organizationId }) {
 const [version, setVersion] = useState(null)
 const versionTrigger = useRef(null)
 const { snapshot, busy, error, load } = useReadSnapshot((cursor = null) => api.payments(organizationId, cursor))
 const page = snapshot?.data
 return <><div hidden={!!version}><section aria-label="Платежи организации">
  <h3>Платежи</h3>
  <p>Тестовая среда (sandbox). Реальные деньги не списываются. Здесь показаны денежные заказы; покупки со скидкой 100% без платежа в этот список не входят.</p>
  <p>Время указано по часовому поясу устройства. Возврат сам по себе не изменяет доступ.</p>
  <p>Загрузка перечитывает сохранённые данные платежей из базы и не запускает сверку с ЮKassa.</p>
  <button type="button" disabled={busy} onClick={() => load()}>Загрузить платежи</button>
  {busy && <p role="status">Загружаем платежи…</p>}
  {error && <p role="alert">{error}</p>}
  {page && <>
   <p>Данные платежей получены: <DeviceDateTime value={snapshot.loadedAt} />.</p>
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
    {client && <OrderFiscalReceipts client={client} workspace={organizationId} order={item.id} />}
    {client && <OrderPurchaseDocuments client={client} workspace={organizationId} order={item.id} />}
    {client && (import.meta.env.VITE_ADMIN_SUBSCRIPTION_REFUNDS === 'true' || isAcceptanceOrganization(client,organizationId)) && item.payment_status === 'succeeded' && !item.payment_requires_review && <SubscriptionRefund key={organizationId+':'+item.id} api={isAcceptanceOrganization(client,organizationId)?{...api,subscriptionFiscalRefundsEnabled:true}:api} client={client} organizationId={organizationId} orderId={item.id} />}
    {item.payment_status === 'succeeded' && !item.payment_requires_review && <RefundPreview api={api} client={client} organizationId={organizationId} orderId={item.id} />}
    {client && import.meta.env.VITE_ADMIN_SANDBOX_REFUNDS === 'true' && <RefundHistory api={api} client={client} organizationId={organizationId} orderId={item.id} />}
   </li>)}</ul>
   {page.next_cursor && <button type="button" disabled={busy} onClick={() => load(page.next_cursor)}>Следующая страница платежей</button>}
  </>}
 </section></div>{version && <section aria-label="Тариф заказа"><button type="button" onClick={() => { setVersion(null); requestAnimationFrame(() => versionTrigger.current?.focus()) }}>К платежам</button><Tariffs key={version} client={client} initialVersionId={version} /></section>}</>
}
