import { expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSubscriptionRefundPreparationEndpoint } from '../supabase/functions/_shared/subscriptionRefundPreparationEndpoint.js'
import { createSubscriptionRefundEndpoint } from '../supabase/functions/_shared/subscriptionRefundEndpoint.js'

export async function verifySubscriptionRefundHttpDatabase(sql, serviceOverride) {
 const source=readFileSync(new URL('../supabase/tests/database/subscription_refund_requests.test.sql',import.meta.url),'utf8')
 const fixture=source.slice(0,source.indexOf("select set_config('test.receipt'" )).replace('select no_plan();','')+
  source.slice(source.indexOf('-- Trusted fixture:'),source.indexOf('savepoint changed_period;'))+'commit;'
 sql(fixture.replaceAll('subscription-refund','subscription-refund-http'))
 const actor=sql("select md5('subscription-refund-http-owner')::uuid").trim()
 const order=JSON.parse(sql(`select to_jsonb(o) from public.billing_sandbox_orders o join public.organizations g on g.id=o.organization_id where g.personal_owner_id='${actor}'`).trim())
 const epoch=Math.floor(Date.now()/1000)
 const auth={getClaims:async()=>({data:{claims:{sub:actor,role:'authenticated',aal:'aal2',exp:epoch+300,amr:[{method:'totp',timestamp:epoch}]}}}),getUser:async()=>({data:{user:{id:actor}}})}
 const literal=value=>value==null?'null':"'"+(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")+"'"
 const service=serviceOverride||{rpc:async(name,args)=>{
  if(!['prepare_subscription_refund_from_gateway','subscription_refund_from_gateway'].includes(name))throw Error('unexpected rpc')
  const call=Object.entries(args).map(([key,value])=>`${key}=>${literal(value)}`).join(',')
  return {data:JSON.parse(sql(`begin;set local role service_role;select public.${name}(${call});commit;`).trim())}
 }}
 const options={enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],auth,service}
 const prepare=createSubscriptionRefundPreparationEndpoint(options)
 const request=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://stage-admin.qvesta.ru'},body:JSON.stringify(body)})
 const body={action:'request',organizationId:order.organization_id,orderId:order.id,commandId:'11111111-1111-4111-8111-111111111111'}
 const quote=await prepare(request(body));expect(quote.status).toBe(200)
 const calculated=await quote.json();expect(calculated.amount_minor).toBe(1000)
 expect(await (await prepare(request(body))).json()).toEqual(calculated)
 const reserve={action:'reserve',organizationId:order.organization_id,orderId:order.id,requestId:calculated.request_id}
 const response=await prepare(request(reserve));expect(response.status).toBe(200)
 const reserved=await response.json()
 expect(await (await prepare(request(reserve))).json()).toEqual(reserved)
 const payment=sql("select md5('subscription-refund-http-payment')::uuid").trim()
 const posts=[];let lost=true
 const endpoint=createSubscriptionRefundEndpoint({...options,providerConfig:{enabled:true,shopId:'123',secretKey:'synthetic'},transport:{fetchImpl:async(url,init)=>{
  if(init.method==='POST'){posts.push({body:init.body,key:init.headers['Idempotence-Key']});if(lost){lost=false;throw Error('lost response')}}
  const data=url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:url.includes('/payments/')?{id:payment,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:{value:'10.00',currency:'RUB'},metadata:{order_id:order.id,organization_id:order.organization_id,plan_version_id:order.plan_version_id,environment:'sandbox'}}:{id:'22222222-2222-4222-8222-222222222222',payment_id:payment,status:'succeeded',amount:{value:'10.00',currency:'RUB'}}
  return {ok:true,json:async()=>data}
 }}})
 expect((await endpoint(request({refundId:reserved.refund_id}))).status).toBe(503)
 expect(sql(`select status from public.organization_subscriptions where organization_id='${order.organization_id}'`).trim()).toBe('active')
 const completed=await endpoint(request({refundId:reserved.refund_id}));expect(completed.status).toBe(200)
 expect((await completed.json()).accessEffect).toBe('applied')
 expect(posts).toHaveLength(2);expect(posts[0]).toEqual(posts[1])
 expect((await endpoint(request({refundId:reserved.refund_id}))).status).toBe(200)
 expect(posts).toHaveLength(2)
 expect(sql(`select count(*) from public.subscription_refund_applications where refund_id='${reserved.refund_id}'`).trim()).toBe('1')
 expect(sql(`select status from public.organization_subscriptions where organization_id='${order.organization_id}'`).trim()).toBe('free')
}
