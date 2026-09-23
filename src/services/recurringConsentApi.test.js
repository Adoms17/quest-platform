import { beforeEach, expect, test, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { listRecurringConsents, readRecurringConsent, requestRecurringConsent, revokeRecurringConsent } from './recurringConsentApi'
const org='11111111-1111-4111-8111-111111111111', order='22222222-2222-4222-8222-222222222222', consent='33333333-3333-4333-8333-333333333333'
beforeEach(() => vi.resetAllMocks())
test('возвращает только безопасные поля статуса', async () => {
 rpc.mockResolvedValue({ data: { state:'saved', consent_id:consent, can_request:false, provider_method_id:'private' } })
 expect(await readRecurringConsent(org,order)).toEqual({state:'saved',consentId:consent,canRequest:false})
})
test('после согласия перечитывает итог, а не доверяет ответу команды', async () => {
 rpc.mockResolvedValueOnce({data:{state:'pending'}}).mockResolvedValueOnce({data:{state:'revoked',consent_id:consent,can_request:false}})
 expect((await requestRecurringConsent(org,order)).state).toBe('revoked')
 expect(rpc.mock.calls[0]).toEqual(['request_sandbox_recurring_consent',{p_organization_id:org,p_order_id:order,p_terms_version:'sandbox-recurring-v2'}])
})
test('неопределённый отзыв не объявляет успехом', async () => {
 rpc.mockResolvedValue({data:'pending'})
 await expect(revokeRecurringConsent(org,order,consent)).rejects.toThrow('Не удалось')
})
test('чужие значения статуса и исходные ошибки не передаются в UI', async () => {
 rpc.mockResolvedValue({error:{message:'private'}})
 await expect(readRecurringConsent(org,order)).rejects.toThrow('Не удалось')
 rpc.mockResolvedValue({data:{state:'enabled',consent_id:consent,can_request:false}})
 await expect(readRecurringConsent(org,order)).rejects.toThrow('Не удалось')
})

test('каталог согласий исключает реквизиты и проверяет ответ', async () => {
 const item={consent_id:consent,order_id:order,state:'saved',created_at:'2026-09-23T00:00:00Z',provider_method_id:'private'}
 rpc.mockResolvedValue({data:[item]})
 expect(await listRecurringConsents(org)).toEqual([{consentId:consent,orderId:order,state:'saved',createdAt:item.created_at}])
 for(const data of [[item,item],[{...item,state:'enabled'}],[{...item,created_at:'bad'}],null]) {
  rpc.mockResolvedValue({data}); await expect(listRecurringConsents(org)).rejects.toThrow('Не удалось')
 }
})