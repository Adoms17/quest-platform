import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

const states = ['none', 'scheduled', 'due', 'stale']
const actions = ['cancel_renewal', 'resume_renewal', 'schedule_downgrade', 'clear_downgrade']
const key = (actor, org) => `billing-command:${actor}:${org}`
export async function loadBillingControls(org, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('get_organization_billing_controls', { p_organization_id: org }), signal)
  if (error) throw error
  if (data?.organization_id !== org || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !states.includes(data.cancel_intent_state) || !states.includes(data.scheduled_intent_state)
    || typeof data.can_request !== 'boolean' || typeof data.can_manage !== 'boolean'
    || typeof data.cancel_at_period_end !== 'boolean' || !Array.isArray(data.downgrade_targets)
    || !data.downgrade_targets.every(t => typeof t.id === 'string' && typeof t.name === 'string'
      && Number.isSafeInteger(t.version) && t.version > 0 && Number.isSafeInteger(t.active_quests) && t.active_quests >= 0
      && Number.isSafeInteger(t.team_members) && t.team_members >= 1)) throw new Error('Некорректное состояние подписки.')
  return data
}
export function readBillingCommand(actor, org) {
  const raw = sessionStorage.getItem(key(actor, org))
  if (!raw) return null
  const value = JSON.parse(raw)
  if (!actions.includes(value.p_action) || value.p_organization_id !== org
    || !Number.isSafeInteger(value.p_expected_revision) || value.p_expected_revision < 0
    || typeof value.p_command_id !== 'string'
    || (value.p_action === 'schedule_downgrade' ? typeof value.p_target_plan_version_id !== 'string' : value.p_target_plan_version_id !== null)) {
    throw new Error('Сохранённый запрос требует проверки.')
  }
  return value
}
export function prepareBillingCommand(actor, org, revision, action, target = null) {
  if (!actor || !org || !actions.includes(action)) throw new Error('Не определён запрос подписки.')
  if (readBillingCommand(actor, org)) throw new Error('Сначала проверьте предыдущий запрос.')
  const command = { p_organization_id: org, p_command_id: crypto.randomUUID(), p_expected_revision: revision,
    p_action: action, p_target_plan_version_id: target }
  sessionStorage.setItem(key(actor, org), JSON.stringify(command))
  return command
}
export async function sendBillingCommand(actor, org) {
  const command = readBillingCommand(actor, org)
  if (!command) throw new Error('Нет сохранённого запроса.')
  const { data, error } = await supabase.rpc('request_organization_billing_intent', command)
  if (error) {
    // Только определённый отказ сервера позволяет забыть неподтверждённую команду.
    if (['40001', '42501', '22023', 'P0001'].includes(error.code)) sessionStorage.removeItem(key(actor, org))
    throw error
  }
  if (data?.organization_id !== org || !Number.isSafeInteger(data.revision)) throw new Error('Не удалось подтвердить запрос.')
  sessionStorage.removeItem(key(actor, org))
  return data
}
