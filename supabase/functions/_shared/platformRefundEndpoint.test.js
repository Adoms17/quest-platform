// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createPlatformRefundEndpoint } from './platformRefundEndpoint.js'
const actor='11111111-1111-4111-8111-111111111111'
const id='22222222-2222-4222-8222-222222222222'
const epoch=Math.floor(Date.now()/1000)
const identity={sub:actor,role:'authenticated',aal:'aal2',exp:epoch+300,amr:[{method:'totp',timestamp:epoch}]}
const request=()=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru'},body:JSON.stringify({refundId:id})})
function setup() {
 const auth={getClaims:vi.fn().mockResolvedValue({data:{claims:identity}}),getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}}})}
 const service={rpc:vi.fn().mockResolvedValue({data:{refund:{id,state:'succeeded'}}})}
 const fetchImpl=vi.fn()
 const handler=createPlatformRefundEndpoint({enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service,providerConfig:{enabled:true,shopId:'123',secretKey:'synthetic'},transport:{fetchImpl}})
 return {auth,service,fetchImpl,handler}
}
test('проверенный MFA доходит до gateway; завершённый возврат не отправляется',async()=>{
 const s=setup();const response=await s.handler(request())
 expect(response.status).toBe(200)
 expect(await response.json()).toEqual({refundId:id,state:'succeeded',environment:'sandbox',accessEffect:'unchanged'})
 expect(s.service.rpc).toHaveBeenCalledWith('sandbox_refund_from_gateway',expect.objectContaining({p_actor_user_id:actor,p_mfa_at:epoch,p_action:'read',p_refund_id:id}))
 expect(s.fetchImpl).not.toHaveBeenCalled()
})
test('отказ БД после проверки JWT запрещает исполнение',async()=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code:'42501'}})
 expect((await s.handler(request())).status).toBe(403)
 expect(s.service.rpc).toHaveBeenCalledTimes(1);expect(s.fetchImpl).not.toHaveBeenCalled()
})
test('отзыв после авторизации оставляет результат неподтверждённым без сети',async()=>{
 const s=setup()
 s.service.rpc.mockResolvedValueOnce({data:{refund:{id,state:'reserved'}}}).mockResolvedValue({error:{code:'42501'}})
 const response=await s.handler(request())
 expect(response.status).toBe(503)
 expect(await response.json()).toEqual({error:'sandbox_refund_unconfirmed',refundId:id})
 expect(s.fetchImpl).not.toHaveBeenCalled()
})
