const reasons = {
 payment_conflict: 'Данные платежа требуют сверки.',
 sandbox_scope_disabled: 'Выдача подписки отключена для этой тестовой организации.',
 discount_reconciliation_required: 'Требуется сверка применения скидки и периода подписки.',
 sandbox_payment_unverified: 'Оплата ещё не подтверждена для выдачи подписки.',
 fully_refunded_trial_duplicate: 'Повторный заказ полностью возвращён; новый период по нему не выдаётся.',
}
export default function PaymentReviewStatus({ item }) {
 const paymentReview = item.payment_requires_review === true
 const refundReview = item.refund_requires_review === true
 const deferred = item.fulfillment_state === 'deferred' && !paymentReview
 const applied = item.fulfillment_state === 'applied' && !paymentReview
 const orderReview = !deferred && !paymentReview && (item.fulfillment_state === 'review' || (item.order_state === 'review' && !['applied', 'not_paid'].includes(item.fulfillment_state)))
 const start = new Date(item.period_start)
 const checked = new Date(item.fulfillment_checked_at)
 const tone = paymentReview || orderReview ? 'review' : applied ? 'applied' : 'waiting'
 return <>
 <section className={`payment-activation payment-activation--${tone}`} aria-label="Активация периода">
  <h4>Активация периода</h4>
  {applied && <p role="status">Период по заказу выдан.</p>}
  {item.fulfillment_state === 'not_paid' && !paymentReview && <p role="status">Период по заказу не выдан.</p>}
  {paymentReview && <p role="status">Требуется проверка платежа. Его результат пока не подтверждён. Перед новой оплатой необходимо сверить существующий платёж.</p>}
  {deferred && <p role="status"><strong>{item.payment_status === 'succeeded' && item.paid === true ? 'Оплачено, ожидает активации.' : 'Период ожидает активации.'}</strong>{item.period_start && Number.isFinite(start.getTime()) && <> Запланированное начало: {start.toLocaleString('ru-RU')}.</>} Фактическую активацию подтверждает сервер. Для получения актуального результата загрузите платежи повторно.</p>}
  {orderReview && <p role="status">Требуется проверка обработки заказа. Статус оплаты сам по себе не подтверждает начало периода подписки. {reasons[item.fulfillment_reason] || 'Причина обработки в этом списке пока не указана.'}</p>}
  {!applied && !deferred && !paymentReview && !orderReview && item.fulfillment_state !== 'not_paid' && <p>Активация периода пока не подтверждена сервером.</p>}
  {item.fulfillment_checked_at && Number.isFinite(checked.getTime()) ? <p className="payment-activation-date">Последняя сверка активации: {checked.toLocaleString('ru-RU')}.</p> : <p className="payment-activation-date">Время последней сверки активации не указано.</p>}
 </section>
 {refundReview && <p role="status">Требуется проверка возврата. Его результат пока не подтверждён. Проверьте историю возвратов перед новой операцией.</p>}
 </>
}