import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function loadMonthlyParticipantUsage(organizationId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('get_monthly_participant_usage', { p_organization_id: organizationId }), signal)
  if (error) throw error
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  if (data?.organization_id !== organizationId || data.timezone !== 'Europe/Moscow'
    || typeof data.is_partial !== 'boolean' || data.enforcement_enabled !== false
    || !validDate(data.period_start) || !validDate(data.period_end) || !validDate(data.measured_at)
    || Date.parse(data.period_end) <= Date.parse(data.period_start)
    || !(data.coverage_started_at === null || validDate(data.coverage_started_at))
    || !(data.participants === null || (Number.isSafeInteger(data.participants) && data.participants >= 0))) {
    throw new Error('Некорректный ответ учёта участников.')
  }
  return data
}
