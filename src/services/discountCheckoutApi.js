import { supabase } from '../supabaseClient'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const failure = () => new Error('Не удалось проверить промокод. Повторите запрос.')
const reasons = ['invalid_code', 'rate_limited', 'offer_unavailable','trial_period_already_paid', 'discount_exhausted']
export async function previewDiscountCheckout(organizationId, offer, code) {
  if (!uuid.test(organizationId) || !uuid.test(offer?.offer_id) || typeof code !== 'string' || code.length > 128) throw failure()
  let response
  try { response = await supabase.rpc('preview_sandbox_discount_offer', { p_organization_id: organizationId, p_offer_id: offer.offer_id, p_code: code.trim() }) }
  catch { throw failure() }
  const { data, error } = response ?? {}
  if (error || typeof data?.ok !== 'boolean') throw failure()
  if (!data.ok) {
    if (!reasons.includes(data.reason)) throw failure()
    return { ok: false, reason: data.reason }
  }
  if (data.organization_id !== organizationId || data.offer_id !== offer.offer_id || data.plan_version_id !== offer.plan_version_id
    || (code.trim() ? !uuid.test(data.discount_id) : data.discount_id !== null || data.discount_bps !== 0 || data.discount_amount_minor !== 0) || data.environment !== 'sandbox' || data.currency !== 'RUB' || data.reserved !== false
    || ![data.base_amount_minor, data.discount_amount_minor, data.amount_minor].every(n => Number.isSafeInteger(n) && n >= 0)
    || data.base_amount_minor !== offer.amount_minor || data.base_amount_minor - data.discount_amount_minor !== data.amount_minor
    || !Number.isInteger(data.discount_bps) || data.discount_bps < (code.trim() ? 1 : 0) || data.discount_bps > 10000
    || data.requires_payment !== (data.amount_minor > 0)
    || !Number.isSafeInteger(data.remaining_periods) || (code.trim() ? data.remaining_periods < 1 : data.remaining_periods !== 0)
    || !Number.isSafeInteger(data.period_months) || data.period_months < 1
    || ![data.valid_until, data.period_start, data.period_end].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    || Date.parse(data.period_end) <= Date.parse(data.period_start)) throw failure()
  const trial = data.trial_purchase
  if (trial !== undefined && (!trial || !['after_trial', 'replace_trial_on_payment'].includes(trial.transition)
    || !uuid.test(trial.access_id) || !uuid.test(trial.source_plan_version_id) || trial.target_plan_version_id !== data.plan_version_id
    || !Number.isSafeInteger(trial.generation) || trial.generation < 0
    || !Number.isSafeInteger(trial.subscription_revision) || trial.subscription_revision < 0
    || trial.period_months !== data.period_months
    || !Number.isFinite(Date.parse(trial.trial_starts_at)) || !Number.isFinite(Date.parse(trial.trial_ends_at))
    || Date.parse(trial.trial_ends_at) <= Date.parse(trial.trial_starts_at)
    || trial.trial_remaining_preserved !== (trial.transition === 'after_trial')
    || trial.paid_starts_on_confirmation !== (trial.transition === 'replace_trial_on_payment')
    || (trial.transition === 'after_trial' ? trial.paid_starts_at !== trial.trial_ends_at || Date.parse(data.period_start) !== Date.parse(trial.trial_ends_at) : trial.paid_starts_at !== null))) throw failure()
  return data
}
