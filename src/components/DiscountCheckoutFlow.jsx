import { loadDocumentCheckoutScope } from '../services/purchaseDocumentsApi'
import PurchaseDocuments from './PurchaseDocuments'
import { useEffect, useRef, useState } from 'react'
import DiscountCheckoutPreview from './DiscountCheckoutPreview'
import { acceptDiscountCheckout, recoverDiscountCheckout, executeDiscountCheckout, cancelDiscountCheckout, dismissDiscountCheckout } from '../services/discountCheckoutCommands'
import { rememberSandboxCheckout } from '../services/sandboxCheckoutApi'
const secondaryButton = 'min-h-11 rounded-lg border border-gray-300 px-4 py-3 text-blue-700 disabled:opacity-50'
const primaryButton = 'min-h-11 rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50'
export default function DiscountCheckoutFlow({ actorId, organizationId, offer, onPayment, onClosed, onSelectionLocked }) {
 const [state, setState] = useState({ loading: true })
 const [requireDocuments,setRequireDocuments]=useState(false)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState(false)
 const running = useRef(false)
 useEffect(() => {
  let active = true
  Promise.all([recoverDiscountCheckout(actorId, organizationId), import.meta.env.VITE_CHECKOUT_DOCUMENTS==='true' ? loadDocumentCheckoutScope(organizationId) : Promise.resolve(false)]).then(([result,required]) => { if (active) {setState(result);setRequireDocuments(required)} }).catch(() => { if (active) { setState({}); setError(true) } })
  return () => { active = false }
 }, [actorId, organizationId])
 useEffect(() => { onSelectionLocked?.(Boolean(state.loading || state.order || busy || error)) }, [state.loading, state.order, busy, error, onSelectionLocked])
 async function run(action) {
  if (running.current) return
  running.current = true; onSelectionLocked?.(true); setBusy(true); setError(false)
  try { const result = await action(); if (result) setState({...result,refresh:Date.now()}) }
  catch { setError(true) }
  finally { running.current = false; setBusy(false) }
 }
 const order = state.order
 if (state.loading) return <p role="status">Восстанавливаем заказ…</p>
 return <section aria-label="Заказ подписки" className="space-y-3">
  {error && <p role="alert">Не удалось подтвердить состояние заказа. Восстановите его перед продолжением.</p>}
  <div className="flex flex-wrap gap-3">
  <button className={secondaryButton} type="button" disabled={busy} onClick={() => run(() => recoverDiscountCheckout(actorId, organizationId))}>Восстановить заказ</button>
  {!order && !error && !state.commandId && <button className={secondaryButton} type="button" disabled={busy} onClick={onClosed}>Вернуться к предложениям</button>}
  </div>
  {!order && !error && <>
   {state.commandId && <p>Ответ предыдущего запроса не найден. Повторное подтверждение использует ту же команду.</p>}
   {state.reason && <p role="alert">{state.reason === 'documents_changed' ? 'Редакции документов изменились. Обновите расчёт, прочитайте новые условия и подтвердите согласие заново.' : state.reason === 'trial_period_already_paid' ? 'Период после пробного доступа уже оплачен. Повторная покупка не требуется.' : 'Заказ не создан: условия или доступность промокода изменились. Проверьте расчёт заново.'}</p>}
   {offer ? <DiscountCheckoutPreview key={JSON.stringify([state.reason,state.commandId,state.refresh])} organizationId={organizationId} offer={offer} busy={busy} requireDocuments={requireDocuments} onConfirm={(code, quote, documents) => run(() => acceptDiscountCheckout(actorId, organizationId, offer.offer_id, code, quote, documents))} /> : <p>Выберите предложение для повторного расчёта.</p>}
  </>}
  {order && <>
   <p>Заказ: {order.order_id}</p>
   {requireDocuments && <PurchaseDocuments key={order.order_id} workspace={organizationId} order={order.order_id} />}
   <p>К оплате: {(order.amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}.</p>
   {error ? null : order.payment_requires_review ? <p role="status">Платёж требует сверки. Повторную покупку не создавайте.</p> : <>
    <div className="flex flex-wrap gap-3">
    {order.state === 'ready' && <button className={primaryButton} disabled={busy} type="button" onClick={() => run(() => executeDiscountCheckout(actorId, organizationId, order.order_id))}>{order.requires_payment ? 'Подготовить тестовый платёж' : 'Получить доступ без доплаты'}</button>}
    {order.payment_order_id && order.state === 'executing' && <button className={secondaryButton} disabled={busy} type="button" onClick={() => run(async () => { rememberSandboxCheckout(actorId, organizationId, order.payment_order_id); onPayment() })}>Перейти к тестовой оплате</button>}
    {['ready','executing'].includes(order.state) && <button className={secondaryButton} disabled={busy} type="button" onClick={() => run(() => cancelDiscountCheckout(actorId, organizationId, order.order_id))}>Отменить до отправки платежа</button>}
    </div>
    {order.state === 'completed' && <p role="status">Заказ исполнен. {order.fulfillment?.access_state === 'scheduled' ? 'Купленный период начинается после trial.' : 'Период доступа подтверждён.'}</p>}
    {order.state === 'cancelled' && <p role="status">Заказ отменён, резерв заказа освобождён.</p>}
    {['completed','cancelled'].includes(order.state) && <button className={secondaryButton} disabled={busy} type="button" onClick={() => run(async () => { await dismissDiscountCheckout(actorId, organizationId); onClosed() })}>Закрыть заказ</button>}
   </>}
  </>}
 </section>
}
