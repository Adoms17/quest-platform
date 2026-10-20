import { SandboxPaymentError } from './yookassaSandbox.js'

// Закрытый серверный исполнитель. repository и provider — доверенные адаптеры,
// а не параметры HTTP-запроса. Выдача периода проверяется отдельной транзакцией БД.
export async function runSandboxRecurring(orderId, { repository, provider }) {
  const attempt = await repository.beginAttempt(orderId)
  if (attempt?.state === 'zero_amount') return { status: (await repository.applyPeriod(orderId)).state }
  if (!['prepared', 'reconciliation_required'].includes(attempt?.state)) return { status: attempt?.state ?? 'unavailable' }
  const order = await repository.readAttempt(orderId)
  if (!order || order.id !== orderId) throw new SandboxPaymentError('recurring_attempt_unavailable')
  let payment
  try {
    // Повторный запуск только читает: отсутствие платежа в поиске не доказывает,
    // что предыдущий POST не будет обработан провайдером позже.
    payment = order.providerPaymentId
      ? await provider.readPayment(order)
      : attempt.state === 'prepared'
        ? await provider.createRecurringPayment(order)
        : await provider.findPayment(order)
  } catch (error) {
    if (error?.code === 'payment_outcome_unknown') return { status: 'reconciliation_required' }
    throw error
  }
  if (!payment) return { status: 'reconciliation_required' }
  // При сбое записи повтор найдёт тот же платёж; новый POST не выполняется.
  const recorded = await repository.recordResult(orderId, payment)
  if (recorded.requiresReview) return { status: 'requires_review' }
  if (recorded.status === 'succeeded') return { status: (await repository.applyPeriod(orderId)).state }
  return { status: recorded.status }
}
