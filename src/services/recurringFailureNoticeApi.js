import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'
export async function readRecurringFailureNotice(organizationId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('read_recurring_failure_notice', { p_organization_id: organizationId }), signal)
  if (error) throw new Error('Не удалось проверить автопродление.')
  if (data === null) return null
  if (data?.status !== 'payment_failed' || !Number.isFinite(Date.parse(data.period_start)) || !Number.isFinite(Date.parse(data.failed_at))) throw new Error('Не удалось проверить автопродление.')
  return { status: data.status, periodStart: data.period_start, failedAt: data.failed_at }
}
