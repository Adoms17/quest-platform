import { SandboxPaymentError } from './yookassaSandbox.js'

// rpc — серверный клиент с service_role и проверенным auth.uid инициатора.
// Его нельзя создавать из пользовательских claims без проверки JWT.
export async function runSandboxCheckout(orderId, { rpc, provider }) {
  async function call(name, args) {
    const { data, error } = await rpc(name, args)
    if (error) throw new SandboxPaymentError('sandbox_storage_unavailable')
    return data
  }
  let current = await call('read_sandbox_payment_order', { p_order_id: orderId })
  if (current?.order?.id !== orderId) throw new SandboxPaymentError('invalid_sandbox_order')
  let payment
  if (current.order.providerPaymentId) payment = await provider.readPayment(current.order)
  else {
    const prepared = await call('begin_sandbox_payment_send', { p_order_id: orderId })
    if (prepared?.can_send === false && prepared.reason === 'payment_already_identified') {
      current = await call('read_sandbox_payment_order', { p_order_id: orderId })
      if (current?.order?.id !== orderId || !current.order.providerPaymentId) throw new SandboxPaymentError('invalid_sandbox_order')
      payment = await provider.readPayment(current.order)
    } else {
      if (prepared?.can_send !== true || prepared.order?.id !== orderId) throw new SandboxPaymentError('payment_reconciliation_required')
      payment = await provider.createPayment(prepared.order)
    }
  }
  const stored = await call('record_sandbox_payment_result', { p_order_id: orderId, p_payment_id: payment.paymentId,
    p_status: payment.status, p_paid: payment.paid, p_test: payment.test, p_confirmation_url: payment.confirmationUrl })
  if (stored?.order_id !== orderId || stored.payment_id !== payment.paymentId) throw new SandboxPaymentError('sandbox_storage_unavailable')
  // Возвращаем записанный статус: параллельный ответ мог уже продвинуть его вперёд.
  return { orderId, paymentId: stored.payment_id, status: stored.status, requiresReview: stored.requires_review,
    confirmationUrl: stored.requires_review ? null : stored.confirmation_url }
}
