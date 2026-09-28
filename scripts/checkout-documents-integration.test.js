// @vitest-environment node
import { test,expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync,readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { prepareSubscriptionFiscalOperation } from '../supabase/functions/_shared/subscriptionFiscalLedger.js'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
test.skipIf(process.env.QVESTA_TEST_CHECKOUT_DOCUMENTS!=='1')('atomic checkout document acceptance with full schema',async()=>{
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

  // Reproduce stage rollout: public tariff prices are already applied before receipts.
  const receiptVersions=new Set(JSON.parse(readFileSync(new URL('../docs/tasks/WEB-PAY-03-migrations.json',import.meta.url),'utf8')).map(item=>item.version))
  const followups=files.filter(file=>file>='20260927010000')
  const base=files.filter(file=>!receiptVersions.has(file.slice(0,14))&&!followups.includes(file))
  const receipts=files.filter(file=>receiptVersions.has(file.slice(0,14)))
  sql(base.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql(receipts.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql(followups.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')

 const tariffPrices=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/tariff_monthly_prices.test.sql',import.meta.url),'utf8'))
 expect(tariffPrices).not.toMatch(/not ok|Looks like/)
 const suite=readFileSync(new URL('../supabase/tests/database/checkout_documents_atomic.test.sql',import.meta.url),'utf8')
 const out=sql('set search_path=public,extensions;'+suite)
 expect(out).not.toMatch(/not ok|Looks like/)
 expect(out).toMatch(/1\.\.\d+/)
 const paid=suite.replace('10000,2,1','5000,2,1').replace("'0','100 percent discount supported'", "'6172','paid checkout with discount supported'")
 const orderChecks=readFileSync(new URL('../supabase/tests/database/platform_order_documents.test.sql',import.meta.url),'utf8')
 const receiptChecks=readFileSync(new URL('../supabase/tests/database/receipt_full_schema.test.sql',import.meta.url),'utf8')
 const paidOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;', () => orderChecks+'\n'+receiptChecks+'\nselect * from finish();rollback;'))
 expect(paidOut).not.toMatch(/not ok|Looks like/)
 const modelChecks=readFileSync(new URL('../supabase/tests/database/subscription_fiscal_model_full_schema.test.sql',import.meta.url),'utf8')
 const modeledOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;', () => orderChecks+'\n'+modelChecks+'\nselect * from finish();rollback;'))
 expect(modeledOut).not.toMatch(/not ok|Looks like/)
 expect(modeledOut).toContain('real other organization cannot recover modeled receipt')
 const recurringReceipt=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/recurring_receipt_snapshot.test.sql',import.meta.url),'utf8'))
 expect(recurringReceipt).not.toMatch(/not ok|Looks like/)
 expect(recurringReceipt).toMatch(/1\.\.\d+/)


 // Commit synthetic receipt fixtures only in this disposable database so two
 // independent PostgreSQL sessions can compete for the same order lock.
 const receiptPrefix=receiptChecks.split('savepoint settlement_fixture;')[0]
 const modeledPrefix=receiptPrefix.replace("now()-interval '1 hour',1,'service','full_prepayment');", `clock_timestamp()+interval '2 seconds',1,'service','full_prepayment');
 insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)
 values(md5('receipt-initial-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end');
 select pg_sleep(2.1);`)
 expect(modeledPrefix).not.toBe(receiptPrefix)
 const dueChecks=readFileSync(new URL('../supabase/tests/database/subscription_settlement_due.test.sql',import.meta.url),'utf8')
 const dueOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+'\n'+dueChecks+'\nselect * from finish();rollback;'))
 expect(dueOut).not.toMatch(/not ok|Looks like/)
 expect(dueOut).toContain('unknown remains in existing reconciliation queue')

 const ledgerChecks=readFileSync(new URL('../supabase/tests/database/subscription_fiscal_reservations.test.sql',import.meta.url),'utf8')
 const ledgerOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+'\n'+ledgerChecks+'\nselect * from finish();rollback;'))
 expect(ledgerOut).not.toMatch(/not ok|Looks like/)
 expect(ledgerOut).toContain('only successful reserves consume version')
 const parity=JSON.parse(ledgerOut.split('\n').find(line=>line.startsWith('{"fiscalParity"'))).fiscalParity
 const line=parity[0].receipt.items[0],paymentId=parity[0].payment_id
 const snapshot={amountMinor:6172,currency:'RUB',email:parity[0].receipt.customer.email,description:line.description,vatCode:line.vat_code,paymentSubject:'service',paymentMode:'full_prepayment'}
 const verifiedPayment={id:paymentId,amountMinor:6172,currency:'RUB',status:'succeeded',receiptRegistration:'succeeded',refundedAmountMinor:0,requiresReview:false}
 const state={paymentId,currency:'RUB',paidMinor:6172,version:0,operations:[]}
 for(const [index,kind,amountMinor] of [[0,'refund',1000],[1,'settlement',5172],[2,'refund',5172]]){
  const draft=prepareSubscriptionFiscalOperation(snapshot,verifiedPayment,state,{id:randomUUID(),kind,amountMinor,expectedVersion:state.version})
  expect(parity[index]).toEqual(draft.body)
  state.operations.push({id:draft.commandId,kind:draft.kind,amountMinor,quantity:draft.quantity,state:'succeeded',receiptStatus:'succeeded'})
  state.version++
  if(kind==='refund')verifiedPayment.refundedAmountMinor+=amountMinor
 }


 const resultChecks=readFileSync(new URL('../supabase/tests/database/subscription_fiscal_results.test.sql',import.meta.url),'utf8')
 const resultPrefix=ledgerChecks.split("select set_config('test.ledger.first'")[0]
 const resultOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+'\n'+resultPrefix+'\n'+resultChecks+'\nselect * from finish();rollback;'))
 expect(resultOut).not.toMatch(/not ok|Looks like/)
 expect(resultOut).toContain('lifecycle chain fully refunded')

 const workerChecks=readFileSync(new URL('../supabase/tests/database/subscription_fiscal_worker.test.sql',import.meta.url),'utf8')
 const workerOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+'\n'+resultPrefix+'\n'+workerChecks+'\nselect * from finish();rollback;'))
 expect(workerOut).not.toMatch(/not ok|Looks like/)
 expect(workerOut).toContain('payment receipt history includes exact settled remainder')
 const bindingChecks=readFileSync(new URL('../supabase/tests/database/subscription_fiscal_refund_binding.test.sql',import.meta.url),'utf8').replace('-- LINKED_LIFECYCLE_CHECKS',()=>readFileSync(new URL('../supabase/tests/database/subscription_fiscal_refund_lifecycle.test.sql',import.meta.url),'utf8'))
 const bindingOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+'\n'+bindingChecks+'\nselect * from finish();rollback;'))
 expect(bindingOut).not.toMatch(/not ok|Looks like/)
 expect(bindingOut).toContain('legacy rejection leaves no fiscal ledger')
 for(const name of ['subscription_refund_preparation','subscription_refund_result','subscription_refund_reconciliation','subscription_refund_recovery','subscription_refund_boundary','subscription_refund_trial']) {
  const regression=sql('set search_path=public,extensions;'+readFileSync(new URL(`../supabase/tests/database/${name}.test.sql`,import.meta.url),'utf8'))
  expect(regression, name).not.toMatch(/not ok|Looks like/)
 }
 const committed=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+modeledPrefix+`
 reset role;
 alter table public.billing_subscription_fiscal_terms disable trigger subscription_fiscal_terms_immutable;
 update public.billing_subscription_fiscal_terms set period_start=now()-interval '1 month',period_end=now();
 alter table public.billing_subscription_fiscal_terms enable trigger subscription_fiscal_terms_immutable;
 reset role;
 insert into public.billing_sandbox_payment_results(order_id,shop_id,payment_id,status,paid)
 values(current_setting('test.payment')::uuid,'123',md5('fiscal-payment')::uuid,'succeeded',true)
 on conflict(order_id) do update set status='succeeded',paid=true,payment_id=md5('fiscal-payment')::uuid,requires_review=false;
 select * from finish(); commit;`))
 expect(committed).not.toMatch(/not ok|Looks like/)
 const orderId=sql('select order_id from public.billing_receipt_payment_requests;').trim()
 expect(orderId).toMatch(/^[0-9a-f-]{36}$/)
 const concurrent=(statement)=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
  let output='',errors=''
  const timer=setTimeout(()=>{child.kill();reject(Error('settlement concurrency timeout'))},15000)
  child.stdout.on('data',chunk=>{output+=chunk})
  child.stderr.on('data',chunk=>{errors+=chunk})
  child.on('error',error=>{clearTimeout(timer);reject(error)})
  child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output.trim());else reject(Error(errors||'concurrent SQL failed'))})
  child.stdin.end(statement ?? `begin; set local role service_role;
 select public.claim_prepayment_settlement('${orderId}'::uuid)->>'action';
 select pg_sleep(1); commit;`)
 })
 // New MODEL-03 ledger races, only in this disposable database.
 const resetLedger=()=>sql(`begin;
 delete from public.billing_subscription_fiscal_operation_status where command_id in
  (select command_id from public.billing_subscription_fiscal_operations where order_id='${orderId}');
 alter table public.billing_subscription_fiscal_operations disable trigger subscription_fiscal_operation_immutable;
 delete from public.billing_subscription_fiscal_operations where order_id='${orderId}';
 alter table public.billing_subscription_fiscal_operations enable trigger subscription_fiscal_operation_immutable;
 delete from public.billing_subscription_fiscal_ledgers where order_id='${orderId}';commit;`)
 const reserve=(command,kind)=>`select platform_private.reserve_subscription_fiscal_operation('${orderId}',md5('${command}')::uuid,0,'${kind}',${kind==='settlement'?6172:1000})::text;`
 for(const [left,right] of [['refund','refund'],['refund','settlement'],['settlement','settlement']]) {
  const raced=await Promise.allSettled([
   concurrent('begin;'+reserve('race-left',left)+'select pg_sleep(1);commit;'),
   concurrent('begin;'+reserve('race-right',right)+'select pg_sleep(1);commit;'),
  ])
  expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(raced.filter(r=>r.status==='rejected')).toHaveLength(1)
  expect(raced.find(r=>r.status==='rejected').reason.message).toContain('fiscal version changed')
  expect(sql('select count(*) from public.billing_subscription_fiscal_operations;').trim()).toBe('1')
  expect(sql('select version from public.billing_subscription_fiscal_ledgers;').trim()).toBe('1')
  resetLedger()
 }
 const repeated=await Promise.all([
  concurrent('begin;'+reserve('same-command','refund')+'select pg_sleep(1);commit;'),
  concurrent('begin;'+reserve('same-command','refund')+'commit;'),
 ])
 expect(repeated[0]).toBe(repeated[1])
 const claims=await Promise.all([concurrent("begin;select platform_private.claim_subscription_fiscal_operation(md5('same-command')::uuid)->>'action';select pg_sleep(1);commit;"),concurrent("begin;select platform_private.claim_subscription_fiscal_operation(md5('same-command')::uuid)->>'action';commit;")])
 expect(claims.sort()).toEqual(['reconcile','send'])

 expect(sql('select count(*) from public.billing_subscription_fiscal_operations;').trim()).toBe('1')
 resetLedger()
 async function waitForLedgerLock() {
  for(let i=0;i<40;i++){
   if(sql("select count(*) from pg_stat_activity where application_name='new-ledger-race' and wait_event='PgSleep';").trim()==='1')return
   await new Promise(resolve=>setTimeout(resolve,50))
  }
  throw Error('new ledger race did not acquire order lock')
 }
 const rollbackReserve=concurrent("set application_name='new-ledger-race';begin;"+reserve('rollback-reserve','refund')+'select pg_sleep(3);rollback;')
 await waitForLedgerLock()
 const afterRollback=concurrent('begin;'+reserve('after-rollback','settlement')+'commit;')
 await Promise.all([rollbackReserve,afterRollback])
 expect(sql('select kind from public.billing_subscription_fiscal_operations;').trim()).toBe('settlement')
 resetLedger()
 const ledgerFirst=concurrent("set application_name='new-ledger-race';begin;"+reserve('ledger-before-legacy','refund')+'select pg_sleep(3);commit;')
 await waitForLedgerLock()
 await expect(concurrent(`begin;set local role service_role;select public.claim_prepayment_settlement('${orderId}');commit;`)).rejects.toThrow('fiscal ledger owns order')
 await ledgerFirst
 resetLedger()
 const actions=await Promise.all([concurrent(),concurrent()])
 expect(actions.sort()).toEqual(['reconcile','send'])
 expect(sql('select count(*) from public.billing_prepayment_settlement_status;').trim()).toBe('1')
 expect(sql('select count(*) from public.billing_prepayment_settlements;').trim()).toBe('1')

 // The first session announces itself through pg_stat_activity only after the
 // guarded operation completed and while its transaction still holds the lock.
 async function waitForHeldLock(app) {
  for(let i=0;i<40;i++) {
   if(sql(`select count(*) from pg_stat_activity where application_name='${app}' and wait_event='PgSleep';`).trim()==='1')return
   await new Promise(resolve=>setTimeout(resolve,50))
  }
  throw Error('race fixture did not hold order lock')
 }
 const refund=`insert into public.billing_sandbox_refunds(id,order_id,actor_id,command_id,amount_minor,payment_id,state,first_sent_at)
 select md5('concurrent-refund')::uuid,id,actor_id,md5('concurrent-refund-command')::uuid,1000,md5('fiscal-payment')::uuid,'sending',now()
 from public.billing_sandbox_orders where id='${orderId}';`
 // Test-only reset in this disposable database. Immutable request stays intact.
 sql('delete from public.billing_prepayment_settlement_status;')
 const firstClaim=concurrent(`set application_name='settlement-first';begin;set local role service_role;
 select public.claim_prepayment_settlement('${orderId}'::uuid)->>'action';select pg_sleep(3);commit;`)
 await waitForHeldLock('settlement-first')
 await expect(concurrent('begin;'+refund+'commit;')).rejects.toThrow('refund after settlement requires review')
 expect(await firstClaim).toBe('send')
 expect(sql('select count(*) from public.billing_sandbox_refunds;').trim()).toBe('0')
 sql('delete from public.billing_prepayment_settlement_status;')
 const firstRefund=concurrent("set application_name='refund-first';begin;"+refund+'select pg_sleep(3);commit;')
 await waitForHeldLock('refund-first')
 await expect(concurrent(`begin;set local role service_role;select public.claim_prepayment_settlement('${orderId}'::uuid);commit;`)).rejects.toThrow('settlement unavailable')
 await firstRefund
 expect(sql('select count(*) from public.billing_sandbox_refunds;').trim()).toBe('1')
 expect(sql('select count(*) from public.billing_prepayment_settlement_status;').trim()).toBe('0')
 await expect(concurrent('begin;'+reserve('legacy-refund-first','settlement')+'commit;')).rejects.toThrow('legacy fiscal operation exists')


 // A fresh linked lifecycle on the same synthetic order, after retiring only
 // the disposable legacy race fixtures. No shared/local application DB is changed.
 sql(`begin;
 delete from public.billing_sandbox_refunds where id=md5('concurrent-refund')::uuid;
 alter table public.billing_prepayment_settlements disable trigger prepayment_settlement_immutable;
 delete from public.billing_prepayment_settlements where order_id='${orderId}';
 alter table public.billing_prepayment_settlements enable trigger prepayment_settlement_immutable;
 select set_config('request.jwt.claim.sub',md5('discount-checkout-owner')::uuid::text,true);
 select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,true);
 insert into public.billing_sandbox_application_scope select organization_id from public.billing_sandbox_orders where id='${orderId}' on conflict do nothing;
 update public.organization_subscriptions s set status='active',plan_version_id=o.plan_version_id,period_start=o.period_start,period_end=o.period_end
 from public.billing_sandbox_orders o where o.id='${orderId}' and s.organization_id=o.organization_id;
 insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
 select id,organization_id,jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end),'{}',jsonb_build_object('revision',(select revision from public.organization_subscriptions where organization_id=public.billing_sandbox_orders.organization_id))
 from public.billing_sandbox_orders where id='${orderId}';
 select public.request_platform_subscription_refund((select organization_id from public.billing_sandbox_orders where id='${orderId}'),'${orderId}',md5('linked-race-command')::uuid);
 commit;`)
 const requestId=sql(`select id from public.subscription_refund_requests where order_id='${orderId}';`).trim()
 const orgId=sql(`select organization_id from public.billing_sandbox_orders where id='${orderId}';`).trim()
 const actor="md5('discount-checkout-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,9999999999,'123'"
 const linkedReserve=`select public.prepare_linked_fiscal_refund_from_gateway(${actor},'${orgId}','${orderId}','${requestId}')::text;`
 const linkedPairs=await Promise.all([
  concurrent('begin;set local role service_role;'+linkedReserve+'select pg_sleep(1);commit;'),
  concurrent('begin;set local role service_role;'+linkedReserve+'commit;'),
 ])
 expect(linkedPairs[0]).toBe(linkedPairs[1])
 expect(sql(`select count(*) from public.billing_sandbox_refunds where fiscal_command_id='${requestId}';`).trim()).toBe('1')
 expect(sql(`select version from public.billing_subscription_fiscal_ledgers where order_id='${orderId}';`).trim()).toBe('1')
 const linkedClaim=`select public.subscription_fiscal_refund_from_gateway(${actor},'claim','${requestId}')->>'action';`
 const linkedClaims=await Promise.all([
  concurrent('begin;set local role service_role;'+linkedClaim+'select pg_sleep(1);commit;'),
  concurrent('begin;set local role service_role;'+linkedClaim+'commit;'),
 ])
 expect(linkedClaims.sort()).toEqual(['reconcile','send'])
 const verified=sql(`select jsonb_build_object('commandId',x.command_id,'paymentId',l.payment_id,'shopId','123',
 'bodySha256',x.body_sha256,'amountMinor',x.amount_minor,'state','succeeded','refundId',md5('linked-race-provider')::uuid,
 'receiptId',null,'receiptStatus','unknown') from public.billing_subscription_fiscal_operations x
 join public.billing_subscription_fiscal_ledgers l on l.order_id=x.order_id where x.command_id='${requestId}';`).trim()
 const recordLinked=`select public.subscription_fiscal_refund_from_gateway(${actor},'record','${requestId}','${verified.replaceAll("'","''")}'::jsonb)->>'accessState';`
 const linkedResults=await Promise.all([
  concurrent('begin;set local role service_role;'+recordLinked+'select pg_sleep(1);commit;'),
  concurrent('begin;set local role service_role;'+recordLinked+'commit;'),
 ])
 expect(linkedResults).toEqual(['applied','applied'])
 expect(sql(`select count(*) from public.subscription_refund_applications where request_id='${requestId}';`).trim()).toBe('1')
 } finally {if(created)docker(['rm','-f',name])}
},180000)
