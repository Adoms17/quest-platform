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
 const orderReview = !deferred && !paymentReview && (item.fulfillment_state === 'review' || (item.order_state === 'review' && !['applied', 'not_paid'].includes(item.fulfillment_state)))
 const start = new Date(item.period_start)
 return <>
  {paymentReview && <p role="status">Требуется проверка платежа. Его результат пока не подтверждён. Перед новой оплатой необходимо сверить существующий платёж.</p>}
  {refundReview && <p role="status">Требуется проверка возврата. Его результат пока не подтверждён. Проверьте историю возвратов перед новой операцией.</p>}
  {deferred && <p role="status">Период ожидает активации.{item.period_start && Number.isFinite(start.getTime()) && <> Запланированное начало: {start.toLocaleString('ru-RU')}.</>} Ожидание само по себе не означает ошибку оплаты.</p>}
  {orderReview && <p role="status">Требуется проверка обработки заказа. Статус оплаты сам по себе не подтверждает начало периода подписки. {reasons[item.fulfillment_reason] || 'Причина обработки в этом списке пока не указана.'}</p>}
 </>
}