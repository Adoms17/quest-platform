import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

const browserKey = 'qvesta:trial-browser:v1'
const key = (actor, org) => `free-access-command:${actor}:${org}`
const hashPattern = /^[0-9a-f]{64}$/
export async function hashPromotionCode(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim().toUpperCase()))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}
export async function getTrialBrowserHash() {
  let seed = localStorage.getItem(browserKey)
  if (seed === null) {
    seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(browserKey, seed)
  }
  if (!hashPattern.test(seed) || localStorage.getItem(browserKey) !== seed) throw new Error('Не удалось сохранить метку браузера для пробного доступа.')
  return hashPromotionCode(seed)
}
async function rpc(name, args, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc(name, args), signal)
  if (error) throw error
  return data
}
const revisionValid = n => Number.isSafeInteger(n) && n >= 0
export async function loadFreeAccessControls(org, hash, signal) {
  const data = await rpc('get_organization_free_access_controls', { p_organization_id: org, p_device_key_hash: hash }, signal)
  if (data?.organization_id !== org || !revisionValid(data.revision) || typeof data.available !== 'boolean' || !Array.isArray(data.targets)) throw new Error('Не удалось проверить условия бесплатного доступа.')
  return data
}
export async function previewPromotion(org, code) {
  const data = await rpc('preview_organization_promotion', { p_organization_id: org, p_code: code })
  if (data?.ok === false) throw failure(data.reason)
  if (data?.ok !== true || data.organization_id !== org || !revisionValid(data.revision)) throw new Error('Не удалось проверить промокод.')
  return data
}
const messages = {
  invalid_code: 'Промокод недоступен: проверьте код, организацию и срок активации.',
  rate_limited: 'Слишком много проверок. Попробуйте через 15 минут.',
  revision_conflict: 'Подписка изменилась. Обновите условия и подтвердите их заново.',
  access_conflict: 'Есть другой бесплатный доступ или запрос смены подписки. Обновите условия.',
  period_unavailable: 'Сейчас нельзя начать бесплатный доступ. Обновите условия.',
}
function failure(reason) { return new Error(messages[reason] || 'Сервер отклонил запрос. Обновите условия.') }
export function readFreeAccessCommand(actor, org) {
  const raw = sessionStorage.getItem(key(actor, org))
  if (!raw) return null
  const c = JSON.parse(raw)
  if (c.org !== org || !['trial', 'promotion', 'reconfirm'].includes(c.kind) || !revisionValid(c.revision)
    || typeof c.id !== 'string' || (c.kind === 'promotion' ? !hashPattern.test(c.codeHash) : typeof c.target !== 'string')
    || (c.kind === 'trial' && !hashPattern.test(c.browserHash))) throw new Error('Сохранённый запрос требует проверки.')
  return c
}
export async function prepareFreeAccessCommand(actor, org, revision, kind, options) {
  if (!actor || !org || !revisionValid(revision) || readFreeAccessCommand(actor, org)) throw new Error('Сначала проверьте предыдущий запрос.')
  const command = { org, revision, kind, id: crypto.randomUUID(), ...(kind === 'promotion'
    ? { codeHash: await hashPromotionCode(options.code) } : { target: options.target, ...(kind === 'trial' ? { browserHash: options.browserHash } : {}) }) }
  sessionStorage.setItem(key(actor, org), JSON.stringify(command))
  return readFreeAccessCommand(actor, org)
}
function finish(actor, org, receipt) {
  if (receipt?.ok === false && Object.hasOwn(messages, receipt.reason)) {
    sessionStorage.removeItem(key(actor, org))
    throw failure(receipt.reason)
  }
  if (receipt?.organization_id !== org || typeof receipt.access_id !== 'string'
    || !['scheduled', 'active'].includes(receipt.state) || !Number.isFinite(Date.parse(receipt.ends_at))) throw new Error('Ответ не подтверждён. Проверьте прежний запрос ещё раз.')
  sessionStorage.removeItem(key(actor, org))
  return receipt
}
export async function sendFreeAccessCommand(actor, org, code = '') {
  const c = readFreeAccessCommand(actor, org)
  if (!c) throw new Error('Нет сохранённого запроса.')
  // Чтение receipt не требует повторного ввода кода и не расходует rate limit.
  const previous = await rpc('get_free_access_command_result', { p_organization_id: org, p_kind: c.kind, p_command_id: c.id })
  if (previous?.organization_id !== org || typeof previous.found !== 'boolean') throw new Error('Не удалось проверить прежний запрос.')
  if (previous.found) return finish(actor, org, previous.receipt)
  if (c.kind === 'promotion' && (!code || await hashPromotionCode(code) !== c.codeHash)) throw new Error('Для повтора введите тот же промокод. Его текст не сохраняется в браузере.')
  const names = { trial: 'request_organization_trial', promotion: 'redeem_organization_promotion', reconfirm: 'reconfirm_organization_trial' }
  let receipt
  try {
    receipt = await rpc(names[c.kind], { p_organization_id: org, p_command_id: c.id, p_expected_revision: c.revision,
      ...(c.kind === 'promotion' ? { p_code: code } : c.kind === 'trial'
        ? { p_plan_version_id: c.target, p_device_key_hash: c.browserHash } : { p_access_id: c.target }) })
  } catch (error) {
    if (['40001', '42501', '22023', 'P0001'].includes(error.code)) sessionStorage.removeItem(key(actor, org))
    throw error
  }
  return finish(actor, org, receipt)
}
