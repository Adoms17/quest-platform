// @vitest-environment node
import { test,expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync,readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  const base=files.filter(file=>!receiptVersions.has(file.slice(0,14)))
  const receipts=files.filter(file=>receiptVersions.has(file.slice(0,14)))
  sql(base.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql(receipts.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
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
 const recurringReceipt=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/recurring_receipt_snapshot.test.sql',import.meta.url),'utf8'))
 expect(recurringReceipt).not.toMatch(/not ok|Looks like/)
 expect(recurringReceipt).toMatch(/1\.\.\d+/)


 // Commit synthetic receipt fixtures only in this disposable database so two
 // independent PostgreSQL sessions can compete for the same order lock.
 const receiptPrefix=receiptChecks.split('savepoint settlement_fixture;')[0]
 const committed=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;',()=>orderChecks+'\n'+receiptPrefix+`
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


 } finally {if(created)docker(['rm','-f',name])}
},180000)
