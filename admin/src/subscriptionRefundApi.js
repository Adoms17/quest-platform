export function createSubscriptionRefundApi(client, { fiscalEnabled = false } = {}) {
 async function invoke(name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) throw error
  if (!data || data.error) throw Error('refund_unconfirmed')
  return data
 }
 return {
  subscriptionFiscalRefundsEnabled: fiscalEnabled,
  requestSubscriptionRefund: async (organizationId, orderId, commandId) => {
   const data = await invoke('admin-subscription-refund-prepare', { action: 'request', organizationId, orderId, commandId })
   if (typeof data.request_id !== 'string' || !Number.isSafeInteger(data.amount_minor) || data.amount_minor < 0 || data.currency !== 'RUB' || !Number.isFinite(Date.parse(data.period_start)) || !Number.isFinite(Date.parse(data.period_end)) || Date.parse(data.period_end) <= Date.parse(data.period_start)) throw Error('invalid_quote')
   return data
  },
  reserveSubscriptionRefund: async (organizationId, orderId, requestId, useFiscal = fiscalEnabled) => {
   const data = await invoke(useFiscal ? 'admin-subscription-fiscal-refund' : 'admin-subscription-refund-prepare', { action: 'reserve', organizationId, orderId, requestId })
   if (data.request_id !== requestId || typeof data.refund_id !== 'string' || (useFiscal && data.fiscal_command_id !== requestId)) throw Error('invalid_reservation')
   return data
  },
  executeSubscriptionRefund: async (refundId, fiscalCommandId) => {
   const data = await invoke(fiscalCommandId ? 'admin-subscription-fiscal-refund' : 'admin-subscription-refund', fiscalCommandId ? { action: 'execute', commandId: fiscalCommandId } : { refundId })
   if (fiscalCommandId && (data.commandId !== fiscalCommandId || typeof data.requiresReview !== 'boolean' || ![null,'unknown','pending','succeeded','canceled'].includes(data.receiptStatus))) throw Error('invalid_fiscal_result')
   if (data.refundId !== refundId || !['reserved','sending','pending','succeeded','canceled','rejected','review'].includes(data.state)
    || !['applied','not_applied','review_required','applied_review_required'].includes(data.accessEffect)) throw Error('invalid_result')
   return data
  },
 }
}
