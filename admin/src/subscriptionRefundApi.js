export function createSubscriptionRefundApi(client, { fiscalEnabled = false } = {}) {
 async function invoke(name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
   let detail
   try { detail = await error.context?.clone().json() } catch { /* unknown response remains recoverable */ }
   if (['receipt_conflict', 'invalid_receipt_time'].includes(detail?.error)) {
    const failure=Error(detail.error)
    if (detail.error==='invalid_receipt_time' && error.context?.status===400) failure.definitiveReceiptRejection=true
    throw failure
   }
   throw error
  }
  if (['receipt_conflict', 'invalid_receipt_time'].includes(data?.error)) throw Error(data.error)
  if (!data || data.error) throw Error('refund_unconfirmed')
  return data
 }
 return {
  subscriptionFiscalRefundsEnabled: fiscalEnabled,
  requestSubscriptionRefund: async (organizationId, orderId, commandId, receipt) => {
   const data = await invoke('admin-subscription-refund-prepare', { action: 'request', organizationId, orderId, commandId, ...(receipt ? { receiptSource: receipt.source, receivedAt: receipt.receivedAt } : {}) })
   if (typeof data.request_id !== 'string' || !Number.isSafeInteger(data.amount_minor) || data.amount_minor < 0 || data.currency !== 'RUB' || !Number.isFinite(Date.parse(data.period_start)) || !Number.isFinite(Date.parse(data.period_end)) || Date.parse(data.period_end) <= Date.parse(data.period_start)) throw Error('invalid_quote')
   // Only historical rows have the explicit NULL pair; never infer unknown time from missing fields.
   const legacyReceipt = receipt?.source==='inapp' && receipt.receivedAt===null
    && data.receipt_source===null && data.received_at===null
    && typeof data.requested_at==='string' && typeof data.registered_at==='string'
    && Number.isFinite(Date.parse(data.registered_at)) && Date.parse(data.requested_at)===Date.parse(data.registered_at)
    && data.policy==='subscription-prorata-v1' && data.reserved===false && data.access_effect==='unchanged'
   if (receipt && !legacyReceipt && (data.receipt_source!==receipt.source || (receipt.source==='email' && Date.parse(data.received_at)!==Date.parse(receipt.receivedAt)) || (receipt.source==='inapp' && Date.parse(data.received_at)!==Date.parse(data.registered_at)) || !Number.isFinite(Date.parse(data.received_at)) || !Number.isFinite(Date.parse(data.registered_at)) || Date.parse(data.received_at)>Date.parse(data.registered_at))) throw Error('invalid_quote')
   return receipt ? {...data, receiptTimeUnknown:legacyReceipt} : data
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
