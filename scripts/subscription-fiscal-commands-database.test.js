// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
function docker(args,input) {
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:60000})
 if(r.status!==0) throw new Error(r.stderr||'Docker failed')
 return r.stdout
}
test.skipIf(process.env.QVESTA_TEST_RECEIPTS!=='1')('subscription fiscal commands, legacy compatibility and concurrent preparation',async()=>{
 const name='qvesta-model-rpc-test-'+randomUUID().replaceAll('-','');let created=false
 try {
  docker(['run','-d','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg; chown postgres:postgres /tmp/test-pg; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg']);created=true
  let ready=false
  for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}
  if(!ready) throw new Error('Postgres not ready')
  const sql=s=>docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],s)
  // Minimal order fixture; full replay and RPC authorization remain integration work.
  sql("create role anon; create role authenticated; create role service_role bypassrls; create extension pgtap; create table public.billing_sandbox_orders(id uuid primary key,shop_id text,amount_minor bigint,currency text,state text,first_sent_at timestamptz,actor_id uuid,organization_id uuid,period_start timestamptz,period_end timestamptz);")
  sql(readFileSync(new URL('../supabase/migrations/20260926019000_receipt_snapshot_storage.sql',import.meta.url),'utf8'))
  const out=sql(readFileSync(new URL('../supabase/tests/database/receipt_snapshot_storage.test.sql',import.meta.url),'utf8'))
  expect(out).not.toMatch(/not ok|Looks like/)
  expect(out).toContain('1..12')
  sql("create schema auth; create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''test.actor'',true),'''')::uuid'; create function public.has_organization_permission(uuid,text) returns boolean language sql as 'select $1::text=current_setting(''test.workspace'',true)';")
  sql(readFileSync(new URL('../supabase/migrations/20260926020000_prepare_sandbox_receipt.sql',import.meta.url),'utf8'))
  const commands=sql(readFileSync(new URL('../supabase/tests/database/prepare_sandbox_receipt.test.sql',import.meta.url),'utf8'))
  expect(commands).not.toMatch(/not ok|Looks like/)
  expect(commands).toContain('1..10')
  sql("create schema platform_private; create function auth.jwt() returns jsonb language sql as 'select current_setting(''request.jwt.claims'',true)::jsonb'; create table public.platform_access_assignments(user_id uuid,role_key text,scope_kind text,revoked_at timestamptz,valid_from timestamptz,expires_at timestamptz);")
  const guards=readFileSync(new URL('../supabase/migrations/20260918040000_confirm_platform_commands.sql',import.meta.url),'utf8')
  sql(guards.slice(guards.indexOf('create function platform_private.require_recent_mfa'),guards.indexOf('alter table public.platform_audit_events')))
  sql(readFileSync(new URL('../supabase/migrations/20260926021000_manage_sandbox_fiscal_policy.sql',import.meta.url),'utf8'))
  sql("create table public.billing_recurring_orders(id uuid,source_order_id uuid,organization_id uuid,plan_version_id uuid,consent_id uuid,quote jsonb,period_start timestamptz,period_end timestamptz); alter table public.billing_recurring_orders add primary key(id); create table public.billing_recurring_attempts(order_id uuid); create table public.billing_recurring_revocations(consent_id uuid); create table public.billing_recurring_cancellations(order_id uuid);")
  sql(readFileSync(new URL('../supabase/migrations/20260926026000_recurring_receipt_snapshot.sql',import.meta.url),'utf8'))
  sql(readFileSync(new URL('../supabase/migrations/20260927010000_subscription_fiscal_model_storage.sql',import.meta.url),'utf8'))
  sql(readFileSync(new URL('../supabase/migrations/20260927011000_subscription_fiscal_model_commands.sql',import.meta.url),'utf8'))
  for (const testFile of ['prepare_sandbox_receipt','subscription_fiscal_model_commands']) {
   const output=sql(readFileSync(new URL('../supabase/tests/database/'+testFile+'.test.sql',import.meta.url),'utf8'))
   expect(output).not.toMatch(/not ok|Looks like/)
   expect(output).toMatch(/1\.\.(10|30)/)
  }
  const policies=sql(readFileSync(new URL('../supabase/tests/database/sandbox_fiscal_policy.test.sql',import.meta.url),'utf8'))
  expect(policies).not.toMatch(/not ok|Looks like/)
  expect(policies).toContain('1..8')
  sql("insert into public.billing_sandbox_orders values('11111111-1111-4111-8111-111111111111','123',100,'RUB','reserved',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now()+interval '1 month'); insert into public.billing_fiscal_policies values('22222222-2222-4222-8222-222222222222','sandbox','123',now()-interval '1 hour',1,'service','full_prepayment',now());")
  const parallelSql=command=>new Promise((resolve,reject)=>{
   const proc=spawn('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
   let output='',error=''
   proc.stdout.on('data',chunk=>{output+=chunk});proc.stderr.on('data',chunk=>{error+=chunk})
   proc.on('error',reject);proc.on('close',code=>code===0?resolve(output):reject(new Error(error)))
   proc.stdin.end(command)
  })
  const command="begin; set local test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; set local test.workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; set local role authenticated; select public.prepare_sandbox_receipt('11111111-1111-4111-8111-111111111111','buyer@example.com'); select pg_sleep(0.2); commit;"
  const results=await Promise.all([parallelSql(command),parallelSql(command)])
  expect(results[0]).toBe(results[1])
  sql("insert into public.billing_fiscal_policies values('33333333-3333-4333-8333-333333333333','sandbox','123',now()-interval '1 minute',2,'service','full_payment',now());")
  expect(await parallelSql(command)).toBe(results[0])
  expect(sql('select count(*) from public.billing_receipt_snapshots; select count(*) from public.billing_receipt_audit;').trim()).toBe('1\n1')
  sql("insert into public.billing_fiscal_policies values('44444444-4444-4444-8444-444444444444','sandbox','123',clock_timestamp()+interval '2 seconds',1,'service','full_prepayment',now()); insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis) values('44444444-4444-4444-8444-444444444444','subscription','subscription_access_v1','ausn','period_end'); select pg_sleep(2.1); insert into public.billing_sandbox_orders values('55555555-5555-4555-8555-555555555555','123',99000,'RUB','reserved',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now()+interval '1 month');")
  const modeledCommand=command.replaceAll('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555')
  const modeledResults=await Promise.all([parallelSql(modeledCommand),parallelSql(modeledCommand)])
  expect(modeledResults[0]).toBe(modeledResults[1])
  expect(sql('select count(*) from public.billing_receipt_snapshots; select count(*) from public.billing_receipt_audit; select count(*) from public.billing_subscription_fiscal_terms;').trim()).toBe('2\n2\n1')
  sql("alter table public.billing_sandbox_orders add column plan_version_id uuid; insert into public.billing_recurring_orders(id,source_order_id,organization_id,quote,period_start,period_end) values('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{\"amount_minor\":100}',now(),now()+interval '1 month'),('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{\"amount_minor\":100}',now(),now()+interval '1 month');")
  const recurring=sql("set role service_role; select public.prepare_recurring_receipt('66666666-6666-4666-8666-666666666666');")
  expect(JSON.parse(recurring.trim())).toMatchObject({policy_id:'33333333-3333-4333-8333-333333333333'})
  expect(()=>sql("set role service_role; select public.prepare_recurring_receipt('77777777-7777-4777-8777-777777777777');")).toThrow('subscription model recurring not supported')


 } finally { if(created) docker(['rm','-f',name]) }
},90000)
