import { SandboxPaymentError } from './yookassaSandbox.js'

export async function runSandboxRecurringBatch({ rpc, worker, shopId }) {
 const preparation = await rpc('prepare_due_sandbox_recurring', { p_shop_id: shopId })
 if (preparation.error) throw new SandboxPaymentError('recurring_preparation_unavailable')
 const { data, error } = await rpc('list_sandbox_recurring_work', { p_shop_id: shopId })
 if (error || !Array.isArray(data) || data.length > 10 || data.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || new Set(data).size !== data.length) {
  throw new SandboxPaymentError('recurring_queue_unavailable')
 }
 const summary = { processed: 0, failed: 0, reconciliationRequired: 0, reviewRequired: 0 }
 for (const id of data) {
  try {
   const result = await worker.run(id)
   summary.processed++
   if (result.status === 'reconciliation_required') summary.reconciliationRequired++
   if (result.status === 'requires_review') summary.reviewRequired++
  } catch { summary.failed++ }
 }
 return summary
}
