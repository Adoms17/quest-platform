import { startRefundAuth } from './subscription-refund-auth.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
export async function verifySubscriptionRefundEdge(container,sql,docker,serviceToken,secret){
 const source=readFileSync(new URL('../supabase/tests/database/subscription_refund_requests.test.sql',import.meta.url),'utf8')
 sql((source.slice(0,source.indexOf("select set_config('test.receipt'")).replace('select no_plan();','')+source.slice(source.indexOf('-- Trusted fixture:'),source.indexOf('savepoint changed_period;'))+'commit;').replaceAll('subscription-refund','subscription-refund-edge'))
 const actor=sql("select md5('subscription-refund-edge-owner')::uuid").trim(),payment=sql("select md5('subscription-refund-edge-payment')::uuid").trim()
 const order=JSON.parse(sql(`select to_jsonb(o) from public.billing_sandbox_orders o join public.organizations g on g.id=o.organization_id where g.personal_owner_id='${actor}'`).trim())
 const auth=await startRefundAuth(container,sql,docker,serviceToken,secret,actor)
 const token=auth.token
 const name=container+'-refund-edge';let started=false
 const request=(path,payload,authorization=token,method='POST')=>{
  const output=docker(['exec','-i',container,'curl','-sS','--max-time','10','-w','\n%{http_code}','-X',method,'-H','Content-Type: application/json','-H','Authorization: Bearer '+authorization,'--data-binary','@-','http://127.0.0.1:9000/'+path],JSON.stringify(payload))
  const cut=output.lastIndexOf('\n');return {status:Number(output.slice(cut+1)),data:JSON.parse(output.slice(0,cut))}
 }
 try{
  docker(['run','-d','--name',name,'--network','container:'+container,
   '--mount',`type=bind,source=${fileURLToPath(new URL('../supabase/functions',import.meta.url))},target=/functions,readonly`,
   '--mount',`type=bind,source=${fileURLToPath(new URL('./fixtures/subscription-refund-edge',import.meta.url))},target=/fixture,readonly`,
   '-e','SUPABASE_URL=http://127.0.0.1:3000','-e','SUPABASE_ANON_KEY=synthetic','-e','SUPABASE_SERVICE_ROLE_KEY='+serviceToken,
   '-e','YOOKASSA_SANDBOX_ENABLED=true','-e','ADMIN_SUBSCRIPTION_REFUNDS_ENABLED=true','-e','YOOKASSA_SANDBOX_SHOP_ID=123','-e','YOOKASSA_SANDBOX_SECRET_KEY=synthetic',
   '-e','QVESTA_TEST_PAYMENT='+payment,'-e','QVESTA_TEST_ORDER='+JSON.stringify(order),
   'supabase/edge-runtime:v1.74.3','start','--main-service','/fixture']);started=true
  let ready=false
  for(let i=0;i<60;i++){try{if(request('prepare',{},token,'GET').status===405){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
  expect(ready,'enabled Edge startup').toBe(true)
  const req={action:'request',organizationId:order.organization_id,orderId:order.id,commandId:'33333333-3333-4333-8333-333333333333'}
  expect(request('prepare',req,'invalid').status).toBe(401)
  expect(request('prepare',req,auth.aal1).status).toBe(401)
  const quote=request('prepare',req);expect(quote.status,JSON.stringify(quote.data)).toBe(200)
  const reserved=request('prepare',{action:'reserve',organizationId:order.organization_id,orderId:order.id,requestId:quote.data.request_id});expect(reserved.status).toBe(200)
  expect(request('send',{refundId:reserved.data.refund_id}).status).toBe(503)
  expect(sql(`select status from public.organization_subscriptions where organization_id='${order.organization_id}'`).trim()).toBe('active')
  const completed=request('send',{refundId:reserved.data.refund_id});expect(completed.status,JSON.stringify(completed.data)).toBe(200)
  expect(completed.data.accessEffect).toBe('applied')
  expect(request('send',{refundId:reserved.data.refund_id}).data.accessEffect).toBe('applied')
  expect(sql(`select count(*) from public.subscription_refund_applications where refund_id='${reserved.data.refund_id}'`).trim()).toBe('1')
  expect(sql(`select status from public.organization_subscriptions where organization_id='${order.organization_id}'`).trim()).toBe('free')
 }finally{try{if(started)docker(['rm','-f',name])}finally{auth.stop()}}
}
