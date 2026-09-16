// Только доверенный серверный клиент с проверенным оператором платформы.
export async function runSandboxRefund(refundId, { rpc, provider }) {
  async function call(name, args) {
    const { data, error } = await rpc(name, args)
    if (error) throw new Error('sandbox_refund_storage_unavailable')
    return data
  }
  let snapshot = await call('read_sandbox_refund', { p_refund_id: refundId })
  if (snapshot?.refund?.id !== refundId) throw new Error('invalid_refund')
  if (snapshot.refund.state === 'rejected') return snapshot.refund
  let result
  if (snapshot.refund.provider_refund_id) result = await provider.readRefund(snapshot)
  else {
    const prepared = await call('begin_sandbox_refund', { p_refund_id: refundId })
    if (prepared?.can_send) {
      snapshot = prepared.snapshot
      if (snapshot?.refund?.id !== refundId) throw new Error('invalid_refund')
      try { result = await provider.createRefund(snapshot) }
      catch (error) {
        if (error?.code === 'refund_request_rejected') return call('reject_sandbox_refund', { p_refund_id: refundId })
        throw error
      }
    } else {
      snapshot = await call('read_sandbox_refund', { p_refund_id: refundId })
      if (snapshot?.refund?.id !== refundId || !snapshot.refund.provider_refund_id) throw new Error('refund_reconciliation_required')
      result = await provider.readRefund(snapshot)
    }
  }
  return call('record_sandbox_refund', { p_refund_id: refundId, p_provider_id: result.refundId, p_status: result.status })
}
