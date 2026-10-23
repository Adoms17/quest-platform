import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
export async function verifyRecurringConcurrency(container, sql) {
 if (!/^qvesta-release-test-[0-9a-f]+$/.test(container)) throw Error('isolated container required')
 const run = source => new Promise((resolve,reject) => {
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
  let output='',error=''
  child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v)
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
  child.stdin.end("set statement_timeout='15s';"+source)
 })
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_recurring_order.test.sql',import.meta.url),'utf8').split('create function pg_temp.prepare()')[0]
 for(const action of ['prepare','revoke']) for(const mode of ['commit','rollback']) {
  const tag=`${action}_${mode}`, prefix=`rc-${tag}-`
  const source=fixture.replaceAll('recurring-',prefix).replaceAll('sandbox-'+prefix+'v2','sandbox-recurring-v2')
  sql('set search_path=public,extensions;'+source+'commit;')
  const owner=`md5('${prefix}order-owner')::uuid`, consent=`md5('${prefix}source-consent')::uuid`
  const org=sql(`select id from public.organizations where personal_owner_id=${owner}`).trim()
  // Активированная скидка: гонка не должна расходовать/резервировать её дважды.
  sql(`insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
   values(md5('${prefix}code')::uuid,'${org}','pro',encode(extensions.digest('${prefix}code','sha256'),'hex'),5000,2,1,now()+interval '1 day',${owner},gen_random_uuid());
   insert into public.billing_discount_reservations(order_id,discount_id,organization_id,request,quote,state)
   values(md5('${prefix}initial')::uuid,md5('${prefix}code')::uuid,'${org}','{}','{}','consumed');`)
  const prepare=`select platform_private.prepare_recurring_order(${consent},(select period_end from public.organization_subscriptions where organization_id='${org}'),1);`
  const revoke=`select set_config('request.jwt.claim.sub',${owner}::text,true);select public.revoke_sandbox_recurring_consent('${org}',${consent});`
  let first,second
  try {
   first=run(`set application_name='rc_first_${tag}';begin;${action==='prepare'?prepare:revoke}select pg_sleep(3);${mode};`)
   let sleeping=false
   for(let i=0;i<40;i++){if(sql(`select count(*) from pg_stat_activity where application_name='rc_first_${tag}' and wait_event='PgSleep'`).trim()==='1'){sleeping=true;break}await new Promise(r=>setTimeout(r,25))}
   expect(sleeping).toBe(true)
   second=run(`set application_name='rc_second_${tag}';begin;${prepare}commit;`)
   let blocked=false
   for(let i=0;i<40;i++){if(sql(`select count(*) from pg_stat_activity where application_name='rc_second_${tag}' and wait_event_type='Lock'`).trim()==='1'){blocked=true;break}await new Promise(r=>setTimeout(r,25))}
   expect(blocked).toBe(true)
   const [a,b]=await Promise.all([first,second]);expect(a.code,a.error).toBe(0)
   const revoked=action==='revoke'&&mode==='commit'
   if(revoked){expect(b.code).not.toBe(0);expect(b.error).toContain('recurring consent unavailable')}
   else expect(b.code,b.error).toBe(0)
   const count=revoked?'0':'1'
   expect(sql(`select count(*) from public.billing_recurring_orders where organization_id='${org}'`).trim()).toBe(count)
   expect(sql(`select count(*) from public.billing_discount_reservations where organization_id='${org}' and state='reserved'`).trim()).toBe(count)
   expect(sql(`select count(*) from public.billing_discount_reservations where organization_id='${org}' and state='consumed'`).trim()).toBe('1')
   if(!revoked){sql(`begin;${revoke}commit;`);expect(sql(`select count(*) from public.billing_discount_reservations where organization_id='${org}' and state='reserved'`).trim()).toBe('0')}
  }finally{await Promise.allSettled([first,second].filter(Boolean))}
 }
}

export async function verifyDispatchConcurrency(container, sql) {
 if (!/^qvesta-release-test-[0-9a-f]+$/.test(container)) throw Error('isolated container required')
 const run=source=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
  let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v)
  child.on('error',reject);child.on('close',code=>resolve({code,output,error}));child.stdin.end("set statement_timeout='15s';"+source)
 })
 const fixture=readFileSync(new URL('../supabase/tests/database/billing_recurring_dispatch.test.sql',import.meta.url),'utf8').split('create function pg_temp.claim()')[0]
 for(const action of ['claim','revoke']) {
  const prefix=`dispatch-${action}-`
  sql('set search_path=public,extensions;'+fixture.replaceAll('recurring-',prefix).replaceAll('sandbox-'+prefix+'v2','sandbox-recurring-v2')+'commit;')
  const owner=`md5('${prefix}order-owner')::uuid`,consent=`md5('${prefix}source-consent')::uuid`
  const org=sql(`select id from public.organizations where personal_owner_id=${owner}`).trim()
  const claim=`select platform_private.claim_recurring_dispatch(a.order_id,a.idempotency_key) from public.billing_recurring_attempts a join public.billing_recurring_orders r on r.id=a.order_id where r.organization_id='${org}';`
  const revoke=`select set_config('request.jwt.claim.sub',${owner}::text,true);select public.revoke_sandbox_recurring_consent('${org}',${consent});`
  let first,second
  try {
   first=run(`set application_name='dispatch_first';begin;${action==='claim'?claim:revoke}select pg_sleep(3);commit;`)
   let ready=false
   for(let i=0;i<40;i++){if(sql("select count(*) from pg_stat_activity where application_name='dispatch_first' and wait_event='PgSleep'").trim()==='1'){ready=true;break}await new Promise(r=>setTimeout(r,25))}
   expect(ready).toBe(true)
   second=run(`set application_name='dispatch_second';begin;${action==='claim'?revoke:claim}commit;`)
   let blocked=false
   for(let i=0;i<40;i++){if(sql("select count(*) from pg_stat_activity where application_name='dispatch_second' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}await new Promise(r=>setTimeout(r,25))}
   expect(blocked).toBe(true)
   const results=await Promise.all([first,second]);for(const r of results)expect(r.code,r.error).toBe(0)
   expect(sql(`select count(*) from public.billing_recurring_dispatches d join public.billing_recurring_orders r on r.id=d.order_id where r.organization_id='${org}'`).trim()).toBe(action==='claim'?'1':'0')
   expect(sql(claim).trim()).toBe('f')
   // Оба запуска видят кандидата, но только первый резервирует слот проверки.
   const queue=`select public.list_sandbox_recurring_work('123');`
   first=run(`set application_name='queue_first';begin;${queue}select pg_sleep(3);commit;`)
   let queueReady=false
   for(let i=0;i<40;i++){if(sql("select count(*) from pg_stat_activity where application_name='queue_first' and wait_event='PgSleep'").trim()==='1'){queueReady=true;break}await new Promise(r=>setTimeout(r,25))}
   expect(queueReady).toBe(true)
   second=run(`begin;${queue}commit;`)
   const queued=await Promise.all([first,second]);for(const result of queued)expect(result.code,result.error).toBe(0)
   expect(queued[1].output.trim()).toBe('[]')
  }finally{await Promise.allSettled([first,second].filter(Boolean))}
 }
}
