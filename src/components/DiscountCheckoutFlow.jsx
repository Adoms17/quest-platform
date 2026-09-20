import { useEffect, useRef, useState } from 'react'
import DiscountCheckoutPreview from './DiscountCheckoutPreview'
import { acceptDiscountCheckout, recoverDiscountCheckout, executeDiscountCheckout, cancelDiscountCheckout, dismissDiscountCheckout } from '../services/discountCheckoutCommands'
import { rememberSandboxCheckout } from '../services/sandboxCheckoutApi'
export default function DiscountCheckoutFlow({ actorId, organizationId, offer, onPayment, onClosed, onSelectionLocked }) {
 const [state, setState] = useState({ loading: true })
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState(false)
 const running = useRef(false)
 useEffect(() => {
  let active = true
  recoverDiscountCheckout(actorId, organizationId).then(result => { if (active) setState(result) }).catch(() => { if (active) { setState({}); setError(true) } })
  return () => { active = false }
 }, [actorId, organizationId])
 useEffect(() => { onSelectionLocked?.(Boolean(state.loading || state.order || busy || error)) }, [state.loading, state.order, busy, error, onSelectionLocked])
 async function run(action) {
  if (running.current) return
  running.current = true; onSelectionLocked?.(true); setBusy(true); setError(false)
  try { const result = await action(); if (result) setState(result) }
  catch { setError(true) }
  finally { running.current = false; setBusy(false) }
 }
 const order = state.order
 if (state.loading) return <p role="status">Восстанавливаем заказ…</p>
 return <section aria-label="Заказ с промокодом" className="space-y-3">
  {error && <p role="alert">Не удалось подтвердить состояние заказа. Восстановите его перед продолжением.</p>}
  <button type="button" disabled={busy} onClick={() => run(() => recoverDiscountCheckout(actorId, organizationId))}>Восстановить заказ</button>
  {!order && !error && <>
   {!state.commandId && <button type="button" disabled={busy} onClick={onClosed}>Вернуться к предложениям</button>}
   {state.commandId && <p>Ответ предыдущего запроса не найден. Повторное подтверждение использует ту же команду.</p>}
   {state.reason && <p role="alert">Заказ не создан: условия или доступность промокода изменились. Проверьте расчёт заново.</p>}
   {offer ? <DiscountCheckoutPreview key={state.reason || 'preview'} organizationId={organizationId} offer={offer} busy={busy} onConfirm={(code, quote) => run(() => acceptDiscountCheckout(actorId, organizationId, offer.offer_id, code, quote))} /> : <p>Выберите предложение для повторного расчёта.</p>}
  </>}
  {order && <>
   <p>Заказ: {order.order_id}</p>
   <p>К оплате: {(order.amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}.</p>
   {error ? null : order.payment_requires_review ? <p role="status">Платёж требует сверки. Повторную покупку не создавайте.</p> : <>
    {order.state === 'ready' && <button disabled={busy} type="button" onClick={() => run(() => executeDiscountCheckout(actorId, organizationId, order.order_id))}>{order.requires_payment ? 'Подготовить платёж со скидкой' : 'Получить доступ без доплаты'}</button>}
    {order.payment_order_id && order.state === 'executing' && <button disabled={busy} type="button" onClick={() => run(async () => { rememberSandboxCheckout(actorId, organizationId, order.payment_order_id); onPayment() })}>Перейти к тестовой оплате</button>}
    {['ready','executing'].includes(order.state) && <button disabled={busy} type="button" onClick={() => run(() => cancelDiscountCheckout(actorId, organizationId, order.order_id))}>Отменить до отправки платежа</button>}
    {order.state === 'completed' && <p role="status">Заказ исполнен. {order.fulfillment?.access_state === 'scheduled' ? 'Купленный период начинается после trial.' : 'Период доступа подтверждён.'}</p>}
    {order.state === 'cancelled' && <p role="status">Заказ отменён, резерв скидки освобождён.</p>}
    {['completed','cancelled'].includes(order.state) && <button disabled={busy} type="button" onClick={() => run(async () => { await dismissDiscountCheckout(actorId, organizationId); onClosed() })}>Закрыть заказ</button>}
   </>}
  </>}
 </section>
}
