// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSubscriptionRefundEndpoint } from './subscriptionRefundEndpoint.js'
const actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',paymentId='33333333-3333-4333-8333-333333333333',providerId='44444444-4444-4444-8444-444444444444'
function setup(){
 const epoch=Math.floor(Date.now()/1000)
 const order={id,organizationId:actor,planVersionId:providerId,idempotencyKey:id,amountMinor:100,currency:'RUB',shopId:'123',environment:'sandbox',returnUrl:'https://stage.qvesta.ru',firstSentAt:new Date().toISOString(),providerPaymentId:paymentId}
 const refund={id,order_id:id,payment_id:paymentId,amount_minor:100,state:'reserved',first_sent_at:null,provider_refund_id:null}
 const auth={getClaims:vi.fn().mockResolvedValue({data:{claims:{sub:actor,role:'authenticated',aal:'aal2',exp:epoch+300,amr:[{method:'totp',timestamp:epoch}]}}}),getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}}})}
 const service={rpc:vi.fn(async(_,args)=>{
  const action=args.p_action
  if(action==='read')return {data:structuredClone({order,refund})}
  if(action==='claim'){refund.state='sending';refund.first_sent_at=new Date().toISOString();return {data:{can_send:true}}}
  if(action==='recover')return {data:{action:refund.provider_refund_id?'read_provider':'retry_same_request',refund_id:id,idempotency_key:id,payment_id:paymentId,amount_minor:100,currency:'RUB',shop_id:'123',valid_until:new Date(Date.now()+3600000).toISOString()}}
  if(action==='record'){refund.state=args.p_result.status;refund.provider_refund_id=args.p_result.refundId;return {data:{refund:structuredClone(refund),access_state:'applied'}}}
 })}
 const fetchImpl=vi.fn(async url=>({ok:true,json:async()=>url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:url.includes('/payments/')?{id:paymentId,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:{value:'1.00',currency:'RUB'},metadata:{order_id:id,organization_id:actor,plan_version_id:providerId,environment:'sandbox'}}:{id:providerId,payment_id:paymentId,status:'succeeded',amount:{value:'1.00',currency:'RUB'}}}))
 const handler=createSubscriptionRefundEndpoint({enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service,providerConfig:{enabled:true,shopId:'123',secretKey:'synthetic'},transport:{fetchImpl}})
 const request=()=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru'},body:JSON.stringify({refundId:id})})
 return {handler,request,service,fetchImpl,refund}
}
test('lost response retries same key and body, known result uses GET',async()=>{
 const s=setup(),normal=s.fetchImpl.getMockImplementation();let first=true
 const log=vi.spyOn(console,'error').mockImplementation(()=>{})
 try{
 s.fetchImpl.mockImplementation(async(url,options)=>{if(options.method==='POST'&&first){first=false;throw new Error('lost response')}return normal(url,options)})
 expect((await s.handler(s.request())).status).toBe(503)
 const response=await s.handler(s.request());expect(response.status).toBe(200)
 expect((await response.json()).accessEffect).toBe('applied')
 const posts=s.fetchImpl.mock.calls.filter(([,o])=>o.method==='POST')
 expect(posts).toHaveLength(2);expect(posts[0][1].body).toBe(posts[1][1].body)
 expect(posts.map(([,o])=>o.headers['Idempotence-Key'])).toEqual([id,id])
 expect(s.service.rpc.mock.calls.filter(([,a])=>a.p_action==='claim')).toHaveLength(1)
 await s.handler(s.request());expect(s.fetchImpl.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(2)
 }finally{log.mockRestore()}
})
test('MFA or database denial stops before provider network',async()=>{
 const s=setup();s.service.rpc.mockResolvedValue({error:{code:'42501'}})
 expect((await s.handler(s.request())).status).toBe(403);expect(s.fetchImpl).not.toHaveBeenCalled()
})
test('recovery denied after payment GET prevents POST',async()=>{
 const s=setup(),normal=s.service.rpc.getMockImplementation();let checks=0
 s.service.rpc.mockImplementation(async(name,args)=>args.p_action==='recover'&&++checks===2?{data:{action:'manual_review'}}:normal(name,args))
 expect((await s.handler(s.request())).status).toBe(503)
 expect(s.fetchImpl.mock.calls.every(([,options])=>options.method==='GET')).toBe(true)
})

test.each([[400,'invalid_request',200],[500,'internal_server_error',503],[429,'too_many_requests',503],[400,'unknown',503]])('provider rejection %s/%s releases only definite failure',async(status,code,expected)=>{
 const s=setup(),normal=s.fetchImpl.getMockImplementation(),rpc=s.service.rpc.getMockImplementation()
 const log=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
  s.service.rpc.mockImplementation(async(name,args)=>{
   if(args.p_action==='reject'){s.refund.state='rejected';return {data:structuredClone(s.refund)}}
   return rpc(name,args)
  })
  s.fetchImpl.mockImplementation(async(url,options)=>options.method==='POST'?{ok:false,status,json:async()=>({code})}:normal(url,options))
  const response=await s.handler(s.request())
  expect(response.status).toBe(expected)
  const rejects=s.service.rpc.mock.calls.filter(([,a])=>a.p_action==='reject')
  expect(rejects).toHaveLength(expected===200?1:0)
  expect(s.service.rpc.mock.calls.filter(([,a])=>a.p_action==='record')).toHaveLength(0)
  if(expected===200){
   expect((await response.json()).accessEffect).toBe('not_applied')
   const calls=s.fetchImpl.mock.calls.length
   expect((await s.handler(s.request())).status).toBe(200)
   expect(s.fetchImpl.mock.calls).toHaveLength(calls)
  }else expect(s.refund.state).toBe('sending')
 }finally{log.mockRestore()}
})
