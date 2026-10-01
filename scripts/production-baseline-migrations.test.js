// @vitest-environment node
import {test,expect} from 'vitest'
import {spawn,spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {randomUUID,randomBytes} from 'node:crypto'
const enabled=process.env.QVESTA_TEST_PRODUCTION_BASELINE==='1'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
test.skipIf(!enabled)('production baseline 99 migrations preserves existing organization across historical chain',async()=>{
 const name='qvesta-release-test-'+randomUUID().replaceAll('-','');let created=false
 try{
  docker(['run','-d','--network','none','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']);created=true
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}if(!ready)throw Error('Postgres not ready')
  const sql=input=>docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input)
  sql('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator; create role dashboard_user; create role supabase_read_only_user;')
  // Fresh GoTrue schema in the isolated database; no shared local stack needed.
  sql('create schema auth; alter role postgres set search_path=auth,public;')
  const authEnvironment={...process.env,
   GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',
   API_EXTERNAL_URL:'http://127.0.0.1',GOTRUE_SITE_URL:'http://127.0.0.1',
   GOTRUE_JWT_SECRET:randomBytes(48).toString('hex'),GOTRUE_LOG_LEVEL:'fatal'}
  const authResult=spawnSync('docker',['run','--rm','--name',name+'-auth','--network','container:'+name,
   ...['GOTRUE_DB_DRIVER','GOTRUE_DB_DATABASE_URL','API_EXTERNAL_URL','GOTRUE_SITE_URL','GOTRUE_JWT_SECRET','GOTRUE_LOG_LEVEL'].flatMap(key=>['-e',key]),
   'supabase/gotrue:v2.196.0','auth','migrate'],{env:authEnvironment,encoding:'utf8',timeout:60000,windowsHide:true})
  // Auth diagnostics may include connection settings; do not print them.
  if(authResult.status!==0){
   spawnSync('docker',['rm','-f',name+'-auth'],{stdio:'ignore',windowsHide:true})
   throw Error('Isolated Auth schema migration failed')
  }
  sql(`alter role postgres reset search_path;
   grant usage on schema auth to anon,authenticated,service_role;
  `)
  for(const helper of ['auth.jwt()','auth.uid()','auth.role()']){
   expect(sql(`select to_regprocedure('${helper}') is not null`).trim(),helper+' supplied by Auth migrations').toBe('t')
  }
  const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()
  const base=files.filter(f=>f.slice(0,14)<='20260914210000'),later=files.filter(f=>f.slice(0,14)>'20260914210000')
  expect(base).toHaveLength(99)
  expect(later).toHaveLength(225)
  sql(base.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql("insert into auth.users(id,email) values(md5('production-baseline-fixture')::uuid,'baseline@example.test');")
  const snapshot=()=>sql("select md5(row_to_json(o)::text) from public.organizations o where personal_owner_id=md5('production-baseline-fixture')::uuid").trim()
  const before=snapshot()
  expect(before).toMatch(/^[a-f0-9]{32}$/)
  for(const file of later){
   try{sql(readFileSync(new URL(file,dir),'utf8'))}catch(error){throw Error('Migration '+file+' failed: '+error.message)}
  }
  expect(snapshot()).toBe(before)
  expect(sql("select s.status from public.organization_subscriptions s join public.organizations o on o.id=s.organization_id where o.personal_owner_id=md5('production-baseline-fixture')::uuid").trim()).toBe('transition')
  expect(sql('select count(*) from cron.job where active').trim()).toBe('0')
  expect(sql('select count(*) from public.billing_sandbox_orders').trim()).toBe('0')
  expect(sql('select count(*) from public.platform_access_assignments').trim()).toBe('0')
  // Test admission cannot be provisioned by browser or Edge service roles.
  const admissionTables=['billing_sandbox_offers','billing_sandbox_application_scope',
   'billing_fiscal_acceptance_fixtures','billing_sandbox_scheduled_orders','billing_sandbox_settlement_schedule']
  for(const table of admissionTables){
   expect(sql(`select count(*) from public.${table}`).trim(),table+' starts empty').toBe('0')
   for(const role of ['anon','authenticated','service_role']){
    expect(sql(`select has_table_privilege('${role}','public.${table}','INSERT,UPDATE,DELETE,TRUNCATE')`).trim(),role+' cannot provision '+table).toBe('f')
   }
  }
  const fixtureGateway='public.prepare_fiscal_acceptance_from_gateway(uuid,bigint,bigint,uuid,text)'
  for(const role of ['anon','authenticated']){
   expect(sql(`select has_function_privilege('${role}','${fixtureGateway}','EXECUTE')`).trim(),role+' cannot call fixture gateway').toBe('f')
  }
  // Actual SQL rejection, not only an ACL assertion. The existing user has no owner assignment.
  expect(()=>sql(`begin; set local role service_role;
   select public.prepare_fiscal_acceptance_from_gateway(md5('production-baseline-fixture')::uuid,
   floor(extract(epoch from now()))::bigint,floor(extract(epoch from now()))::bigint+300,
   md5('unprovisioned-fixture')::uuid,'baseline@example.test'); rollback;`)).toThrow('platform owner required')
  expect(sql('select count(*) from public.billing_sandbox_orders').trim()).toBe('0')
  expect(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'billing_%' and not c.relrowsecurity").trim()).toBe('0')
  const guardSource=readFileSync(new URL('./production-sandbox-guard.candidate.sql',import.meta.url),'utf8')
  expect(()=>sql(`begin;
   do $mutate$ declare source text; definition text; begin
    select prosrc,pg_get_functiondef(oid) into source,definition from pg_proc where oid='public.begin_sandbox_payment_send(uuid)'::regprocedure;
    execute replace(definition,source,E'-- begin is a comment, not the function entry\n'||source);
   end; $mutate$;
   ${guardSource.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')}
   rollback;`)).toThrow('sandbox guard source hash mismatch: public.begin_sandbox_payment_send(uuid)')
  expect(sql("select to_regclass('platform_private.billing_runtime_environment') is null").trim()).toBe('t')
  sql(guardSource)
  const guardedCalls=[
   'public.reserve_sandbox_payment_order(null,null,null,null,null,null,null,null,null)',
   'public.begin_sandbox_payment_send(null)',
   'public.record_sandbox_payment_result(null,null,null,null,null,null)',
   "public.apply_sandbox_payment_event(null,'{}'::jsonb)",
   'public.reserve_sandbox_refund(null,null,null)',
   'public.begin_sandbox_refund(null)',
   'public.record_sandbox_refund(null,null,null)',
   'public.claim_prepayment_settlement(null)',
   'public.record_prepayment_settlement(null,null,null)',
   'public.retry_sandbox_subscription_refund_application(null,null)',
   "public.sandbox_recurring_worker_command(null,'begin',null,null)",
   "public.sandbox_recurring_worker_command(null,'claim',null,null)",
   "public.sandbox_recurring_worker_command(null,'record',null,null)",
  ]
  for(const environment of ['unconfigured','production']){
   if(environment==='production')sql("insert into platform_private.billing_runtime_environment(environment) values('production')")
   for(const call of guardedCalls){
    expect(()=>sql(`begin; set local role service_role; select ${call}; rollback;`),environment+' '+call).toThrow('sandbox environment denied')
   }
   expect(()=>sql(`select public.prepare_fiscal_acceptance_fixture(null,null)`),environment+' internal fixture').toThrow('sandbox environment denied')
   for(const call of [
    'platform_private.claim_subscription_refund_dispatch(null)',
    'platform_private.reserve_subscription_fiscal_operation(null,null,null,null,null)',
    'platform_private.claim_subscription_fiscal_operation(null)',
    'platform_private.record_subscription_fiscal_result(null,null,null,null,null,null,null,null,null)',
    'platform_private.check_linked_fiscal_refund_send(null,null)',
    'platform_private.record_linked_subscription_fiscal_refund(null,null)',
    'platform_private.authorize_recurring_send(null,null)',
    'platform_private.apply_recurring_period(null)',
    'platform_private.fulfill_discount_payment(null)',
    'platform_private.fulfill_zero_discount_checkout(null)',
    'platform_private.run_scheduled_sandbox_orders()',
    'platform_private.run_scheduled_subscription_settlements()',
    'platform_private.apply_subscription_refund(null)',
    'platform_private.apply_current_subscription_refund(null)',
    'platform_private.apply_future_trial_subscription_refund(null)',
    'platform_private.schedule_confirmed_period_after_trial(null)',
    'platform_private.confirm_trial_checkout_replacement(null)',
    'platform_private.defer_future_discount_payment(null)',
   ])expect(()=>sql(`select ${call}`),environment+' '+call).toThrow('sandbox environment denied')
   // Read-only reconciliation entry remains usable; no new sends are authorized.
   expect(sql("set role service_role; select public.sandbox_recurring_worker_command(null,'read',null,null) is null").trim()).toBe('t')
  }
  for(const role of ['anon','authenticated','service_role']){
   expect(()=>sql(`begin; set local role ${role}; update platform_private.billing_runtime_environment set environment='sandbox'; rollback;`),role+' cannot change environment').toThrow('permission denied')
  }
  sql("update platform_private.billing_runtime_environment set environment='sandbox'")
  // Sandbox passes the environment guard and reaches the original authorization.
  expect(()=>sql('select public.begin_sandbox_payment_send(null)')).toThrow('billing management denied')
  expect(sql('select count(*) from public.billing_sandbox_orders').trim()).toBe('0')
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
  expect(JSON.parse(sql('select platform_private.run_scheduled_sandbox_orders()').trim()).sent).toBe(0)
  expect(JSON.parse(sql('select platform_private.run_scheduled_subscription_settlements()').trim()).sent).toBe(0)
  for(const suite of ['billing_sandbox_inbox','billing_sandbox_refunds','billing_recurring_gateway',
   'billing_recurring_apply','subscription_fiscal_full_refund']){
   let source=readFileSync(new URL('../supabase/tests/database/'+suite+'.test.sql',import.meta.url),'utf8')
   if(suite==='billing_sandbox_inbox'){
    const marker="insert into public.billing_sandbox_application_scope select organization_id from public.billing_sandbox_orders where id=current_setting('test.current')::uuid;"
    const checks=`
     select public.enqueue_billing_confirmation(o.organization_id,o.id,o.expected_revision,o.plan_version_id,o.period_start,o.period_end) from public.billing_sandbox_orders o where id=current_setting('test.current')::uuid;
     select set_config('test.legacy.before',(select to_jsonb(s)::text from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id=current_setting('test.current')::uuid),true);
     update platform_private.billing_runtime_environment set environment='production';
     set local role service_role;
     select throws_ok($legacy$select public.process_billing_confirmation(current_setting('test.current')::uuid)$legacy$,'42501','sandbox environment denied','production denies legacy queued sandbox period');
     select throws_ok($legacy$select public.process_due_billing_confirmations(100)$legacy$,'42501','sandbox environment denied','production batch denies legacy sandbox period');
     reset role;
     delete from platform_private.billing_runtime_environment;
     set local role service_role;
     select throws_ok($legacy$select public.process_billing_confirmation(current_setting('test.current')::uuid)$legacy$,'42501','sandbox environment denied','unknown environment denies legacy queued sandbox period');
     select throws_ok($legacy$select public.process_due_billing_confirmations(100)$legacy$,'42501','sandbox environment denied','unknown environment batch denies legacy sandbox period');
     reset role;
     select is((select to_jsonb(s)::text from public.organization_subscriptions s join public.billing_sandbox_orders o on o.organization_id=s.organization_id where o.id=current_setting('test.current')::uuid),current_setting('test.legacy.before'),'legacy denial rolls back subscription update');
     select is((select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.current')::uuid),0::bigint,'legacy denial creates no confirmation');
     select is((select state from public.billing_confirmation_inbox where confirmation_id=current_setting('test.current')::uuid),'pending','legacy denial preserves pending queue');
     insert into platform_private.billing_runtime_environment(environment) values('sandbox');
    `
    expect(source).toContain(marker)
    source=source.replace(marker,marker+'\n'+checks)
   }
   const output=sql('set search_path=public,extensions;'+source)
   expect(output,suite).not.toMatch(/^not ok /m)
   expect(output,suite).toMatch(/^1\.\.\d+/m)
  }
  const readSuite=name=>readFileSync(new URL('../supabase/tests/database/'+name+'.test.sql',import.meta.url),'utf8')
  const pinSource=readFileSync(new URL('./production-environment-pin.candidate.sql',import.meta.url),'utf8')
  const pinInTransaction=pinSource.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
  const withHistoryPreflight=(source,tables)=>{
   const checks=`
    reset role;
    create temporary table history_before(relation_name text, rows jsonb);
    ${tables.map(table=>`select ok(exists(select 1 from public.${table}),'preflight fixture contains ${table}');
     insert into history_before select '${table}',coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t;`).join('\n')}
    delete from platform_private.billing_runtime_environment;
    ${pinInTransaction}
    do $preflight$
    begin
     begin
      insert into platform_private.billing_runtime_environment(environment) values('production');
      raise exception 'preflight unexpectedly accepted history';
     exception when sqlstate '55000' then
      if sqlerrm not like 'production environment requires clean billing history: %' then raise; end if;
     end;
    end; $preflight$;
    select is((select count(*) from platform_private.billing_runtime_environment),0::bigint,'history preflight leaves environment unset');
    ${tables.map(table=>`select is((select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t),(select rows from history_before where relation_name='${table}'),'preflight preserves ${table}');`).join('\n')}
   `
   const result=source.replace('select * from finish();rollback;',()=>checks+'\nselect * from finish();rollback;')
   expect(result).not.toBe(source)
   return result
  }
  const recurringHistory=sql('set search_path=public,extensions;'+withHistoryPreflight(readSuite('billing_recurring_apply'),['billing_recurring_attempts','billing_sandbox_orders']))
  expect(recurringHistory).not.toMatch(/not ok|Looks like/)
  expect(recurringHistory).toContain('preflight preserves billing_recurring_attempts')
  const paid=readSuite('checkout_documents_atomic').replace('10000,2,1','5000,2,1')
   .replace("'0','100 percent discount supported'","'6172','paid checkout with discount supported'")
  const trialSource=readSuite('billing_trial_payment_schedule')
  const denialChecks=`
   select set_config('test.guard.before',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
   update platform_private.billing_runtime_environment set environment='production';
   select is((select (public.effective_trial_subscription(s,s.period_end-interval '1 second')).status from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),'trial','ordinary trial before boundary preserved');
   select throws_ok($guard$select public.effective_trial_subscription(s,s.period_end) from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid$guard$,'42501','sandbox environment denied','production denies saved future period');
   select throws_ok($guard$select public.advance_organization_trial(current_setting('test.org')::uuid)$guard$,'42501','sandbox environment denied','production runner denies saved purchase');
   delete from platform_private.billing_runtime_environment;
   select throws_ok($guard$select public.effective_trial_subscription(s,s.period_end+interval '1 second') from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid$guard$,'42501','sandbox environment denied','unknown environment denies saved future period');
   select is((select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.guard.before'),'denials preserve subscription');
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  `
  const guardedTrial=trialSource.replace('select pg_sleep(greatest',denialChecks+'\nselect pg_sleep(greatest')
  expect(guardedTrial).not.toBe(trialSource)
  const trialOutput=sql('set search_path=public,extensions;'+withHistoryPreflight(guardedTrial,['billing_trial_paid_periods','billing_sandbox_orders']))
  expect(trialOutput).not.toMatch(/not ok|Looks like/)
  expect(trialOutput).toContain('denials preserve subscription')
  expect(trialOutput).toMatch(/^1\.\.\d+/m)
  const receiptPrefix=readSuite('receipt_full_schema').split('savepoint settlement_fixture;')[0]
  const modeledPrefix=receiptPrefix.replace("now()-interval '1 hour',1,'service','full_prepayment');",`clock_timestamp()+interval '2 seconds',1,'service','full_prepayment');
   insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
   values(md5('receipt-initial-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end');
   select pg_sleep(2.1);`)
  expect(modeledPrefix).not.toBe(receiptPrefix)
  const resultPrefix=readSuite('subscription_fiscal_reservations').split("select set_config('test.ledger.first'")[0]
  const workerSql=paid.replace('select * from finish();rollback;',()=>readSuite('platform_order_documents')+'\n'+modeledPrefix+'\n'+resultPrefix+'\n'+readSuite('subscription_fiscal_worker')+'\nselect * from finish();rollback;')
  expect(workerSql).not.toBe(paid)
  const workerOutput=sql('set search_path=public,extensions;'+withHistoryPreflight(workerSql,['billing_receipt_snapshots','billing_subscription_fiscal_operations','billing_sandbox_orders']))
  expect(workerOutput).not.toMatch(/not ok|Looks like/)
  expect(workerOutput).toContain('payment receipt history includes exact settled remainder')
  expect(workerOutput).toMatch(/^1\.\.\d+/m)
  const asyncSql=input=>new Promise((resolve,reject)=>{
   const child=spawn('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
   let output='',error=''
   child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x)
   child.on('error',reject);child.on('close',code=>resolve({code,output,error}))
   child.stdin.end("set statement_timeout='15s';"+input)
  })
  let holder,changer
  try{
   holder=asyncSql("set application_name='guard_holder';begin;select platform_private.require_sandbox_environment();select pg_sleep(4);commit;")
   let holding=false
   for(let i=0;i<50;i++){
    if(sql("select count(*) from pg_stat_activity where application_name='guard_holder' and wait_event='PgSleep'").trim()==='1'){holding=true;break}
    await new Promise(r=>setTimeout(r,20))
   }
   expect(holding,'sandbox operation holds environment lock').toBe(true)
   changer=asyncSql("set application_name='guard_changer';update platform_private.billing_runtime_environment set environment='production';")
   let blocked=false
   for(let i=0;i<50;i++){
    if(sql("select count(*) from pg_stat_activity where application_name='guard_changer' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}
    await new Promise(r=>setTimeout(r,20))
   }
   expect(blocked,'environment switch waits for sandbox transaction').toBe(true)
   for(const result of await Promise.all([holder,changer]))expect(result.code,result.error).toBe(0)
   expect(()=>sql('select platform_private.require_sandbox_environment()')).toThrow('sandbox environment denied')
  }finally{await Promise.allSettled([holder,changer].filter(Boolean))}
  for(const outcome of ['commit','rollback']){
   sql("update platform_private.billing_runtime_environment set environment='sandbox'")
   let first,second
   try{
    first=asyncSql(`set application_name='environment_first';begin;update platform_private.billing_runtime_environment set environment='production';select pg_sleep(4);${outcome};`)
    let changed=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='environment_first' and wait_event='PgSleep'").trim()==='1'){changed=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(changed,'operator changed row in open transaction').toBe(true)
    second=asyncSql("set application_name='sandbox_second';select platform_private.require_sandbox_environment();")
    let blocked=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='sandbox_second' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(blocked,'sandbox waits for configuration '+outcome).toBe(true)
    const [a,b]=await Promise.all([first,second])
    expect(a.code,a.error).toBe(0)
    if(outcome==='commit'){
     expect(b.code).not.toBe(0)
     expect(b.error).toContain('sandbox environment denied')
    }else expect(b.code,b.error).toBe(0)
   }finally{await Promise.allSettled([first,second].filter(Boolean))}
  }
  // Earlier transitions exercise the unpinned guard. The release candidate also
  // pins identity, so ordinary operator DML cannot reclassify stored access.
  sql('delete from platform_private.billing_runtime_environment')
  sql(readFileSync(new URL('./production-environment-pin.candidate.sql',import.meta.url),'utf8'))
  expect(()=>sql(`begin;
   insert into public.billing_sandbox_application_scope select id from public.organizations where personal_owner_id=md5('production-baseline-fixture')::uuid;
   insert into platform_private.billing_runtime_environment(environment) values('production');commit;`)).toThrow('production environment requires clean billing history: billing_sandbox_application_scope')
  expect(sql('select count(*) from platform_private.billing_runtime_environment').trim()).toBe('0')
  for(const fixture of [
   {table:'billing_confirmation_inbox',insert:"insert into auth.users(id,email) values(md5('preflight-inbox-owner')::uuid,'preflight-inbox@example.test'); select public.enqueue_billing_confirmation((select id from public.organizations where personal_owner_id=md5('preflight-inbox-owner')::uuid),gen_random_uuid(),0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),now()+interval '1 day',now()+interval '32 days');",error:'production environment requires clean billing history: billing_confirmation_inbox'},
   {table:'billing_fiscal_policies',insert:"insert into public.billing_fiscal_policies(environment,shop_id,effective_at,vat_code,payment_subject,payment_mode) values('sandbox','123',clock_timestamp()+interval '1 hour',1,'service','full_prepayment');",error:'production environment requires clean fiscal policies'},
   {table:'billing_period_confirmations',insert:"insert into auth.users(id,email) values(md5('preflight-confirmation-owner')::uuid,'preflight-confirmation@example.test'); select public.confirm_organization_subscription_period((select id from public.organizations where personal_owner_id=md5('preflight-confirmation-owner')::uuid),gen_random_uuid(),0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),now(),now()+interval '1 month');",error:'production environment requires clean billing history: billing_period_confirmations'},
  ]){
   const output=sql(`begin;${fixture.insert}
    create temporary table preflight_before as select to_jsonb(t) as row from public.${fixture.table} t;
    do $check$ begin
     begin
      insert into platform_private.billing_runtime_environment(environment) values('production');
      raise exception 'history unexpectedly accepted';
     exception when sqlstate '55000' then
      if sqlerrm<> '${fixture.error}' then raise; end if;
     end;
     if exists(select 1 from platform_private.billing_runtime_environment) then raise exception 'environment unexpectedly set'; end if;
     if (select count(*) from preflight_before)<>1 then raise exception 'fixture missing'; end if;
     if exists((select row from preflight_before except select to_jsonb(t) from public.${fixture.table} t)
      union all (select to_jsonb(t) from public.${fixture.table} t except select row from preflight_before)) then raise exception 'history changed'; end if;
    end; $check$;
    select 'isolated history preserved';rollback;`)
   expect(output,fixture.table).toContain('isolated history preserved')
  }
  expect(sql("begin;insert into platform_private.billing_runtime_environment(environment) values('production');select environment from platform_private.billing_runtime_environment;rollback;").trim()).toBe('production')
  const productionConfirmation=sql(`begin;
   insert into platform_private.billing_runtime_environment(environment) values('production');
   insert into auth.users(id,email) values(md5('production-common-confirmation')::uuid,'production-common@example.test');
   select set_config('test.production.org',(select id::text from public.organizations where personal_owner_id=md5('production-common-confirmation')::uuid),true);
   select set_config('test.production.confirmation',gen_random_uuid()::text,true);
   select set_config('test.production.plan',(select id::text from public.billing_plan_versions where plan_key='pro' and version=1),true);
   set local role service_role;
   select public.enqueue_billing_confirmation(current_setting('test.production.org')::uuid,current_setting('test.production.confirmation')::uuid,0,current_setting('test.production.plan')::uuid,now(),now()+interval '1 month');
   select public.process_due_billing_confirmations(100);
   select public.process_billing_confirmation(current_setting('test.production.confirmation')::uuid);
   reset role;
   do $verify$ begin
    if not exists(select 1 from public.organization_subscriptions where organization_id=current_setting('test.production.org')::uuid and status='active' and revision=1) then raise exception 'production common period not applied exactly once'; end if;
    if (select count(*) from public.billing_period_confirmations where confirmation_id=current_setting('test.production.confirmation')::uuid)<>1 then raise exception 'production confirmation count wrong'; end if;
    if not exists(select 1 from public.billing_confirmation_inbox where confirmation_id=current_setting('test.production.confirmation')::uuid and state='applied') then raise exception 'production queue not applied'; end if;
    if exists(select 1 from public.billing_sandbox_orders) then raise exception 'unexpected sandbox order'; end if;
   end; $verify$;
   select 'production common confirmation and replay passed';rollback;`)
  expect(productionConfirmation).toContain('production common confirmation and replay passed')
  for(const outcome of ['commit','rollback']){
   let writer,initializer
   try{
    writer=asyncSql(`set application_name='history_writer';begin;
     insert into public.billing_sandbox_application_scope select id from public.organizations where personal_owner_id=md5('production-baseline-fixture')::uuid;
     select pg_sleep(4);${outcome};`)
    let writing=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='history_writer' and wait_event='PgSleep'").trim()==='1'){writing=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(writing,'history write remains uncommitted').toBe(true)
    initializer=asyncSql("set application_name='history_preflight';begin;insert into platform_private.billing_runtime_environment(environment) values('production');select environment from platform_private.billing_runtime_environment;rollback;")
    let blocked=false
    for(let i=0;i<50;i++){
     if(sql("select count(*) from pg_stat_activity where application_name='history_preflight' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}
     await new Promise(r=>setTimeout(r,20))
    }
    expect(blocked,'preflight waits for history '+outcome).toBe(true)
    const [writeResult,initialResult]=await Promise.all([writer,initializer])
    expect(writeResult.code,writeResult.error).toBe(0)
    if(outcome==='commit'){
     expect(initialResult.code).not.toBe(0)
     expect(initialResult.error).toContain('production environment requires clean billing history: billing_sandbox_application_scope')
     expect(sql('select count(*) from public.billing_sandbox_application_scope').trim()).toBe('1')
    }else{
     expect(initialResult.code,initialResult.error).toBe(0)
     expect(initialResult.output).toContain('production')
     expect(sql('select count(*) from public.billing_sandbox_application_scope').trim()).toBe('0')
    }
    expect(sql('select count(*) from platform_private.billing_runtime_environment').trim()).toBe('0')
   }finally{await Promise.allSettled([writer,initializer].filter(Boolean))}
   // Only the synthetic scope row in this disposable container is removed.
   sql("delete from public.billing_sandbox_application_scope where organization_id=(select id from public.organizations where personal_owner_id=md5('production-baseline-fixture')::uuid)")
  }
  let provisioner,competitor
  try{
   provisioner=asyncSql("set application_name='initial_environment';begin;insert into platform_private.billing_runtime_environment(environment) values('sandbox');select pg_sleep(4);commit;")
   let holding=false
   for(let i=0;i<50;i++){
    if(sql("select count(*) from pg_stat_activity where application_name='initial_environment' and wait_event='PgSleep'").trim()==='1'){holding=true;break}
    await new Promise(r=>setTimeout(r,20))
   }
   expect(holding,'initial sandbox identity is uncommitted').toBe(true)
   competitor=asyncSql("set application_name='competing_environment';insert into platform_private.billing_runtime_environment(environment) values('production');")
   let blocked=false
   for(let i=0;i<50;i++){
    if(sql("select count(*) from pg_stat_activity where application_name='competing_environment' and wait_event_type='Lock'").trim()==='1'){blocked=true;break}
    await new Promise(r=>setTimeout(r,20))
   }
   expect(blocked,'competing initial identity waits').toBe(true)
   const [first,second]=await Promise.all([provisioner,competitor])
   expect(first.code,first.error).toBe(0)
   expect(second.code).not.toBe(0)
   expect(second.error).toContain('duplicate key value violates unique constraint')
   expect(sql('select count(*) from platform_private.billing_runtime_environment').trim()).toBe('1')
  }finally{await Promise.allSettled([provisioner,competitor].filter(Boolean))}
  for(const command of [
   "update platform_private.billing_runtime_environment set environment='production'",
   'delete from platform_private.billing_runtime_environment',
   'truncate platform_private.billing_runtime_environment',
  ])expect(()=>sql(command)).toThrow('billing environment identity immutable')
  sql("update platform_private.billing_runtime_environment set environment='sandbox'")
  expect(sql('select environment from platform_private.billing_runtime_environment').trim()).toBe('sandbox')
  const confirmation='public.confirm_organization_subscription_period(uuid,uuid,bigint,uuid,timestamptz,timestamptz)'
  for(const role of ['anon','authenticated'])expect(sql(`select has_function_privilege('${role}','${confirmation}','EXECUTE')`).trim()).toBe('f')
  for(const gateway of [
   'public.enqueue_billing_confirmation(uuid,uuid,bigint,uuid,timestamptz,timestamptz)',
   'public.process_billing_confirmation(uuid)',
   'public.recheck_expiration_billing_review(uuid)',
  ])for(const role of ['anon','authenticated'])expect(sql(`select has_function_privilege('${role}','${gateway}','EXECUTE')`).trim(),role+' cannot call '+gateway).toBe('f')
 }finally{if(created)docker(['rm','-f',name])}
},180000)
