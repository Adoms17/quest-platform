export function createSubscriptionRefundApi(client) {
 async function invoke(name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) throw error
  if (!data || data.error) throw Error('refund_unconfirmed')
  return data
 }
 return {
  requestSubscriptionRefund: async (organizationId, orderId, commandId) => {
   const data = await invoke('admin-subscription-refund-prepare', { action: 'request', organizationId, orderId, commandId })
   if (typeof data.request_id !== 'string' || !Number.isSafeInteger(data.amount_minor) || data.amount_minor < 0 || data.currency !== 'RUB' || !Number.isFinite(Date.parse(data.period_start)) || !Number.isFinite(Date.parse(data.period_end)) || Date.parse(data.period_end) <= Date.parse(data.period_start)) throw Error('invalid_quote')
   return data
  },
  reserveSubscriptionRefund: async (organizationId, orderId, requestId) => {
   const data = await invoke('admin-subscription-refund-prepare', { action: 'reserve', organizationId, orderId, requestId })
   if (data.request_id !== requestId || typeof data.refund_id !== 'string') throw Error('invalid_reservation')
   return data
  },
  executeSubscriptionRefund: async refundId => {
   const data = await invoke('admin-subscription-refund', { refundId })
   if (data.refundId !== refundId || !['reserved','sending','pending','succeeded','canceled','rejected','review'].includes(data.state)
    || !['applied','not_applied','review_required','applied_review_required'].includes(data.accessEffect)) throw Error('invalid_result')
   return data
  },
 }
}
