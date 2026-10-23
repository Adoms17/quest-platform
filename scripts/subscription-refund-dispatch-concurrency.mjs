import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
export async function verifyRefundDispatchConcurrency(container, sql) {
 if(!/^qvesta-release-test-[a-f0-9]{32}$/.test(container))throw Error('isolated container required')
 const source=readFileSync(new URL('../supabase/tests/database/billing_recurring_dispatch.test.sql',import.meta.url),'utf8').split('create function pg_temp.claim()')[0].replace('select no_plan();','').replace('current_setting(\'test.org\')::uuid,gen_random_uuid(),0',"current_setting('test.org')::uuid,md5('recurring-source-order')::uuid,0")
 const extra=`insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid) values(md5('recurring-source-order')::uuid,'123',md5('recurring-payment')::uuid,'succeeded',true);
 insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(auth.uid(),'owner','platform');
 select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
 select set_config('test.request',public.request_platform_subscription_refund(current_setting('test.org')::uuid,md5('recurring-source-order')::uuid,gen_random_uuid())->>'id',true);
 select platform_private.bind_subscription_refund_period(current_setting('test.request')::uuid);
 insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,provider_refund_id,first_sent_at)
 select md5('recurring-refund')::uuid,order_id,auth.uid(),gen_random_uuid(),amount_minor,md5('recurring-payment')::uuid,'succeeded',gen_random_uuid(),clock_timestamp() from public.subscription_refund_requests where id=current_setting('test.request')::uuid;
 insert into public.subscription_refund_reservations values(current_setting('test.request')::uuid,md5('recurring-refund')::uuid,clock_timestamp());commit;`
 const run=text=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
  let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x)
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}));child.stdin.end("set statement_timeout='15s';"+text)
 })
 for(const mode of ['dispatch','refund']){
  const fixture=(source+extra).replaceAll('recurring-',`rf-${mode}-`).replaceAll(`sandbox-rf-${mode}-v2`,'sandbox-recurring-v2')
  const link=fixture.match(/insert into public.subscription_refund_reservations[^;]+;/)[0]
  sql(mode==='dispatch'?fixture.replace(link,''):fixture)
  const org=sql(`select id from public.organizations where personal_owner_id=md5('rf-${mode}-order-owner')::uuid`).trim()
  const claim=`select platform_private.claim_recurring_dispatch(a.order_id,a.idempotency_key) from public.billing_recurring_attempts a join public.billing_recurring_orders r on r.id=a.order_id where r.organization_id='${org}';`
  const refund=`select public.retry_sandbox_subscription_refund_application('123',md5('rf-${mode}-refund')::uuid)->>'access_state';`
  let first,second
  try{
   first=run(`set application_name='refund_dispatch_first';begin;${mode==='dispatch'?claim:refund}select pg_sleep(3);commit;`)
   let ready=false
   for(let i=0;i<50;i++){if(sql("select count(*) from pg_stat_activity where application_name='refund_dispatch_first' and wait_event='PgSleep'").trim()==='1'){ready=true;break}await new Promise(r=>setTimeout(r,20))}
   expect(ready).toBe(true)
   second=run(`set application_name='refund_dispatch_second';begin;${mode==='dispatch'?`select 1 from public.organization_subscriptions where organization_id='${org}' for update;`+link.replace("current_setting('test.request')::uuid","(select id from public.subscription_refund_requests where order_id=md5('rf-dispatch-source-order')::uuid)")+refund:claim}commit;`)
   let blocked=false
   for(let i=0;i<50;i++){if(sql("select count(*) from pg_stat_activity where application_name='refund_dispatch_second' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}await new Promise(r=>setTimeout(r,20))}
   expect(blocked).toBe(true)
   const [a,b]=await Promise.all([first,second]);expect(a.code,a.error).toBe(0);expect(b.code,b.error).toBe(0)
   expect(b.output.trim().split('\n').at(-1)).toBe(mode==='dispatch'?'review_required':'f')
   expect(sql(`select status from public.organization_subscriptions where organization_id='${org}'`).trim()).toBe(mode==='dispatch'?'active':'free')
   expect(sql(`select count(*) from public.billing_recurring_dispatches d join public.billing_recurring_orders r on r.id=d.order_id where r.organization_id='${org}'`).trim()).toBe(mode==='dispatch'?'1':'0')
   if(mode==='dispatch'){
    sql(`begin;select set_config('request.jwt.claim.sub',md5('rf-dispatch-order-owner')::uuid::text,true);select public.revoke_sandbox_recurring_consent('${org}',md5('rf-dispatch-source-consent')::uuid);commit;`)
    expect(sql(refund).trim()).toBe('review_required')
    // Trusted fixture for a verified canceled payment; no provider call is made.
    sql(`insert into public.billing_recurring_results(order_id,payment_id,status,paid) select id,gen_random_uuid(),'canceled',false from public.billing_recurring_orders where organization_id='${org}';`)
    expect(sql(refund).trim()).toBe('applied')
    expect(sql(`select status from public.organization_subscriptions where organization_id='${org}'`).trim()).toBe('free')
   }
  }finally{await Promise.allSettled([first,second].filter(Boolean))}
 }
}
