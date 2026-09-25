export async function retrySubscriptionRefundAccess({ rpc, shopId }) {
  const { data: ids, error } = await rpc('list_sandbox_subscription_refund_applications', { p_shop_id: shopId })
  if (error || !Array.isArray(ids)) throw new Error('refund_access_storage_unavailable')
  const summary = { checked: 0, review: 0, failed: 0 }
  for (const id of ids) {
    try {
      const { data, error: retryError } = await rpc('retry_sandbox_subscription_refund_application', {
        p_shop_id: shopId, p_refund_id: id,
      })
      if (retryError || !data) throw new Error('refund_access_storage_unavailable')
      if (data.access_state === 'review_required' || data.access_state === 'applied_review_required') summary.review++
    } catch { summary.failed++ }
    summary.checked++
  }
  return summary
}
