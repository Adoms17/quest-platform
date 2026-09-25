// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSubscriptionRefundPreparationEndpoint } from './subscriptionRefundPreparationEndpoint.js'
const id='11111111-1111-4111-8111-111111111111'
function setup() {
 const now=Math.floor(Date.now()/1000)
 const auth={getClaims:vi.fn(async()=>({data:{claims:{sub:id,role:'authenticated',aal:'aal2',exp:now+300,amr:[{method:'totp',timestamp:now}]}}})),getUser:vi.fn(async()=>({data:{user:{id}}}))}
 const service={rpc:vi.fn(async()=>({data:{request_id:id,amount_minor:100}}))}
 const handler=createSubscriptionRefundPreparationEndpoint({enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service})
 const request=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru'},body:JSON.stringify(body)})
 return {auth,service,handler,request}
}
const payload={action:'request',organizationId:id,orderId:id,commandId:id}
test.each(['amount','actorId','mfaAt','requestId'])('rejects extra client field %s',async key=>{
 const s=setup();expect((await s.handler(s.request({...payload,[key]:id}))).status).toBe(400);expect(s.service.rpc).not.toHaveBeenCalled()
})
test('passes verified identity and preserves retry command',async()=>{
 const s=setup();await s.handler(s.request(payload));await s.handler(s.request(payload))
 expect(s.service.rpc.mock.calls[0]).toEqual(s.service.rpc.mock.calls[1])
 expect(s.service.rpc.mock.calls[0][1]).toMatchObject({p_actor_user_id:id,p_command_id:id,p_request_id:null})
})
test('reserve uses request identifier only',async()=>{
 const s=setup();await s.handler(s.request({action:'reserve',organizationId:id,orderId:id,requestId:id}))
 expect(s.service.rpc.mock.calls[0][1]).toMatchObject({p_action:'reserve',p_command_id:null,p_request_id:id})
})
test('invalid auth cannot touch storage',async()=>{
 const s=setup();s.auth.getClaims.mockResolvedValue({error:{}})
 expect((await s.handler(s.request(payload))).status).toBe(401);expect(s.service.rpc).not.toHaveBeenCalled()
})
test('oversized request cannot touch storage',async()=>{
 const s=setup();expect((await s.handler(s.request({...payload,commandId:'x'.repeat(2000)}))).status).toBe(400);expect(s.service.rpc).not.toHaveBeenCalled()
})
test('storage failure hides details and does not claim cancellation',async()=>{
 const s=setup();s.service.rpc.mockRejectedValue(Error('private details'))
 const response=await s.handler(s.request(payload));expect(response.status).toBe(503)
 expect(await response.json()).toEqual({error:'refund_preparation_unconfirmed'})
})

test('database authorization denial is not exposed as storage detail',async()=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code:'42501',message:'private'}})
 const response=await s.handler(s.request(payload));expect(response.status).toBe(403)
 expect(await response.json()).toEqual({error:'refund_access_denied'})
})
test('untrusted origin and wrong method cannot touch storage',async()=>{
 const s=setup()
 expect((await s.handler(new Request('https://example.test',{method:'POST',headers:{origin:'https://untrusted.test'}}))).status).toBe(403)
 expect((await s.handler(new Request('https://example.test'))).status).toBe(405)
 expect(s.service.rpc).not.toHaveBeenCalled()
})
test('disabled preparation returns no-store without auth or database',async()=>{
 const response=await createSubscriptionRefundPreparationEndpoint({})(new Request('https://example.test',{method:'POST'}))
 expect(response.status).toBe(503);expect(response.headers.get('Cache-Control')).toBe('no-store')
})
