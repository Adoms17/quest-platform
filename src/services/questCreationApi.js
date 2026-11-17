import { supabase } from '../supabaseClient'

// Только ключ и SHA-256 параметров; содержимое квеста в хранилище не записываем.
export async function createOrganizationQuest(userId, organizationId, values, sourceQuestId = null) {
  if (!userId || !organizationId) throw new Error('Не определён аккаунт или организация.')
  const ordered = Object.fromEntries(Object.keys(values).sort().map(key => [key, values[key]]))
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ordered)))
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = `quest-create:${userId}:${organizationId}:${sourceQuestId || 'new'}:${hash}`
  let operationId = sessionStorage.getItem(storageKey)
  if (!operationId) {
    operationId = crypto.randomUUID()
    sessionStorage.setItem(storageKey, operationId)
  }
  const { data, error } = await supabase.rpc('create_organization_quest', {
    p_organization_id: organizationId, p_operation_id: operationId,
    p_values: values, p_source_quest_id: sourceQuestId,
  })
  if (error) throw error
  if (typeof data !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
    throw new Error('Некорректный ответ создания квеста.')
  }
  sessionStorage.removeItem(storageKey)
  return data
}
