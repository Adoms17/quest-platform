import { verifySubscriptionRefundPostgrest } from './subscription-refund-postgrest.mjs'
import { verifyRefundDispatchConcurrency } from './subscription-refund-dispatch-concurrency.mjs'
// @vitest-environment node
import { test, expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const enabled=process.env.QVESTA_TEST_SUBSCRIPTION_REFUND==='1'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
test.skipIf(!enabled)('refund workers serialize commit and rollback without duplicate applications',async()=>{
 const name='qvesta-release-test-'+randomUUID().replaceAll('-','');let created=false
 try {
  docker(['run','-d','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']);created=true
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}if(!ready)throw Error('Postgres not ready')
  const sql=input=>docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input)
  sql('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator; create role dashboard_user; create role supabase_read_only_user;')
  // Только схема Auth, без аккаунтов, данных приложения и настроек доступа.
  const auth=docker(['exec','supabase_db_quest-platform','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--schema=auth','--no-publications','--no-subscriptions'])
  sql(auth.replace(/^CREATE TRIGGER[^;]*EXECUTE FUNCTION public\.[^;]*;/gm,'').replace(/^ALTER DEFAULT PRIVILEGES[^;]*;/gm,''))
  const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()

  sql(files.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
  for(const suite of readdirSync(new URL('../supabase/tests/database/',import.meta.url)).filter(f=>f.startsWith('subscription_refund_')&&f.endsWith('.test.sql'))){
   const output=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/'+suite,import.meta.url),'utf8'))
   expect(output,suite).not.toMatch(/^not ok /m);expect(output,suite).toMatch(/^1\.\.\d+/m)
  }
  const source=readFileSync(new URL('../supabase/tests/database/subscription_refund_requests.test.sql',import.meta.url),'utf8')
  const fixture=source.slice(0,source.indexOf('select is(')).replace('select no_plan();','')+
   source.slice(source.indexOf('-- Trusted fixture:'),source.indexOf('savepoint changed_period;'))+
   source.slice(source.indexOf('-- Trusted provider-success fixture;'),source.indexOf("select set_config('test.applied'"))+'commit;'
  const asyncSql=source=>new Promise((resolve,reject)=>{
   const child=spawn('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
   let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x)
   child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
   child.stdin.end("set statement_timeout='15s';"+source)
  })
  for(const mode of ['commit','rollback']){
   sql(fixture.replaceAll('subscription-refund',`subscription-refund-${mode}`))
   const id=sql(`select id from public.billing_sandbox_refunds where id=md5('confirmed-subscription-refund-${mode}')::uuid`).trim()
   const call=`select public.retry_sandbox_subscription_refund_application('123','${id}')->>'access_state';`
   let first,second
   try{
    first=asyncSql(`set application_name='refund_first_${mode}';begin;set local role service_role;${call}select pg_sleep(3);${mode};`)
    let ready=false
    for(let i=0;i<50;i++){
     if(sql(`select count(*) from pg_stat_activity where application_name='refund_first_${mode}' and wait_event='PgSleep'`).trim()==='1'){ready=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(ready,'first worker applied inside open transaction').toBe(true)
    second=asyncSql(`set application_name='refund_second_${mode}';begin;set local role service_role;${call}commit;`)
    let blocked=false
    for(let i=0;i<50;i++){
     if(sql(`select count(*) from pg_stat_activity where application_name='refund_second_${mode}' and wait_event_type='Lock'`).trim()==='1'){blocked=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(blocked,'second worker actually waited for lock').toBe(true)
    const results=await Promise.all([first,second])
    for(const result of results){expect(result.code,result.error).toBe(0);expect(result.output).toContain('applied')}
    expect(sql(`select count(*) from public.subscription_refund_applications where refund_id='${id}'`).trim()).toBe('1')
    expect(sql(`select s.status from public.organization_subscriptions s join public.subscription_refund_requests r using(organization_id) join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id='${id}'`).trim()).toBe('free')
    expect(sql(`select count(*) from public.billing_sandbox_refunds where id='${id}'`).trim()).toBe('1')
   }finally{await Promise.allSettled([first,second].filter(Boolean))}
  }
  for(const mode of ['payment-first','refund-first']){
   sql(fixture.replaceAll('subscription-refund',`subscription-refund-${mode}`)
    .replace("now()+interval '1 day',now()+interval '31 days'","now()-interval '1 day',now()+interval '31 days'")
    .replace(",1000,md5(",",(current_setting('test.receipt')::jsonb->>'amount_minor')::bigint,md5("))
   const id=sql(`select id from public.billing_sandbox_refunds where id=md5('confirmed-subscription-refund-${mode}')::uuid`).trim()
   const state=JSON.parse(sql(`select to_jsonb(s) from public.organization_subscriptions s join public.subscription_refund_requests r using(organization_id) join public.subscription_refund_reservations l on l.request_id=r.id where l.refund_id='${id}'`).trim())
   const confirmation=randomUUID()
   const payment=`select public.confirm_organization_subscription_period('${state.organization_id}','${confirmation}',${state.revision},'${state.plan_version_id}','${state.period_start}','${state.period_end}'::timestamptz+interval '1 day');`
   const refund=`select public.retry_sandbox_subscription_refund_application('123','${id}')->>'access_state';`
   let first,second
   try{
    first=asyncSql(`set application_name='race_first';begin;set local role service_role;${mode==='payment-first'?payment:refund}select pg_sleep(3);commit;`)
    let ready=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='race_first' and wait_event='PgSleep'").trim()==='1'){ready=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(ready,mode+' first operation ready').toBe(true)
    second=asyncSql(`set application_name='race_second';begin;set local role service_role;${mode==='payment-first'?refund:payment}commit;`)
    let blocked=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='race_second' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(blocked,mode+' second operation waits').toBe(true)
    const [a,b]=await Promise.all([first,second]);expect(a.code,a.error).toBe(0)
    if(mode==='payment-first'){
     expect(b.code,b.error).toBe(0);expect(b.output).toContain('review_required')
     expect(sql(`select status from public.organization_subscriptions where organization_id='${state.organization_id}'`).trim()).toBe('active')
     expect(sql(`select count(*) from public.subscription_refund_applications where refund_id='${id}'`).trim()).toBe('0')
     expect(sql(`select count(*) from public.billing_period_confirmations where confirmation_id='${confirmation}'`).trim()).toBe('1')
    }else{
     expect(b.code).not.toBe(0);expect(b.error).toContain('billing revision conflict')
     expect(sql(`select status from public.organization_subscriptions where organization_id='${state.organization_id}'`).trim()).toBe('free')
     expect(sql(`select count(*) from public.billing_period_confirmations where confirmation_id='${confirmation}'`).trim()).toBe('0')
    }
   }finally{await Promise.allSettled([first,second].filter(Boolean))}
  }
 sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
 const preflight=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/subscription_refund_preflight.test.sql',import.meta.url),'utf8'))
 expect(preflight).not.toMatch(/^not ok /m);expect(preflight).toMatch(/^1\.\.8/m)
 const zeroRenewal=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/subscription_refund_zero_renewal.test.sql',import.meta.url),'utf8'))
 expect(zeroRenewal).not.toMatch(/^not ok /m);expect(zeroRenewal).toMatch(/^1\.\.7/m)
 await verifyRefundDispatchConcurrency(name,sql)
 await verifySubscriptionRefundPostgrest(name,sql)
 }finally{if(created&&/^qvesta-release-test-[a-f0-9]{32}$/.test(name))docker(['rm','-f',name])}
},180000)