// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Только явно включённый локальный Docker. Никаких URL, ключей или данных приложения.
const enabled = process.env.QVESTA_TEST_TARIFF_CONCURRENCY === '1'
const container = 'supabase_db_quest-platform'
const database = `qvesta_tariff_test_${randomUUID().replaceAll('-', '')}`
let created = false
function sync(args, input) {
  const r = spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(r.stderr || 'Docker command failed')
  return r.stdout.trim()
}
function sql(text, db = database) {
  return sync(['psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], text)
}
const owner = "md5('concurrency-owner')::uuid"
const source = "md5('concurrency-source')::uuid"
const auth = `set role authenticated;
select set_config('request.jwt.claim.sub',${owner}::text,false);
select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,false);`
function connection(text, name) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'])
  let out = '', err = ''
  child.stdout.on('data', x => { out += x })
  child.stderr.on('data', x => { err += x })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({ code, out: out.trim(), err }))
  })
  child.stdin.write(`set application_name='${name}'; set statement_timeout='15s'; ${text}\n`)
  return { child, done }
}
async function waitBlocked(name) {
  for (let i = 0; i < 100; i++) {
    if (sql(`select count(*) from pg_stat_activity where datname=current_database() and application_name='${name}' and wait_event_type='Lock'`) === '1') return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Second connection did not wait on a lock')
}
async function race(first, second) {
  const a = connection(`begin; ${auth} ${first}; select 'READY';`, 'tariff_first')
  // Wait for the first mutation while its transaction deliberately remains open.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('First connection not ready')), 10000)
    a.child.stdout.on('data', x => { if (String(x).includes('READY')) { clearTimeout(timer); resolve() } })
    a.done.then(r => { if (r.code) { clearTimeout(timer); reject(new Error(r.err)) } })
  })
  const b = connection(`${auth} ${second};`, 'tariff_second')
  b.child.stdin.end()
  try { await waitBlocked('tariff_second') } finally { a.child.stdin.end('commit;\n') }
  const results = await Promise.all([a.done, b.done])
  expect(results[0].code).toBe(0)
  return results[1]
}
function draft(name) {
  sql(`${auth} select public.save_platform_tariff_draft(md5('${name}-save')::uuid,md5('${name}')::uuid,${source},0,'Synthetic',5,3,14);`)
  return `md5('${name}')::uuid`
}
function publish(command, id, day = 2) {
  return `select public.publish_tariff_draft(md5('${command}')::uuid,${id},1,(current_date+${day})::timestamptz)`
}
beforeAll(() => {
  if (!enabled) return
  // Schema-only includes no accounts, drafts, payment rows or secrets.
  const schema = sync(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--schema=public', '--schema=auth', '--schema=platform_private', '--no-publications', '--no-subscriptions'])
  sql(`create database ${database}`, 'postgres'); created = true
  sql('create extension postgis with schema public; create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions; create extension pg_trgm with schema extensions;')
  // Default ACL для системных владельцев не нужны в одноразовой БД; ACL объектов сохранены.
  sql('begin;\n' + schema.replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;').replace(/^ALTER DEFAULT PRIVILEGES[^;]*;/gm, '') + '\ncommit;')
  sql(`insert into public.billing_lifecycle_policy_versions(version,grace_hours,grace_after_cancellation) values(1,120,true);
insert into public.platform_roles values ('owner','Synthetic owner');
insert into auth.users(id,email) values (${owner},'concurrency@example.test');
insert into public.platform_access_assignments(user_id,role_key,scope_kind) values (${owner},'owner','platform');
insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit) values (${source},'pro',1,'Synthetic Pro',5,3);`)
  const applied = new Set(sql('select version from supabase_migrations.schema_migrations', 'postgres').split('\n'))
  for (const file of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => /^20260920\d{6}_.*\.sql$/.test(name)).sort()) if (!applied.has(file.slice(0,14))) sql(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url),'utf8'))
  sql(`insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at) values (${source},${source},'pro',now()-interval '1 day') on conflict do nothing;`)
}, 60000)
afterAll(() => {
  if (created && /^qvesta_tariff_test_[a-f0-9]{32}$/.test(database)) sql(`drop database ${database} with (force)`, 'postgres')
}, 20000)

test.skipIf(!enabled)('одновременный retry создаёт один снимок', async () => {
  const id = draft('retry'), command = publish('retry-command',id)
  const result = await race(command,command)
  expect(result.code).toBe(0)
  expect(sql(`select count(*) from public.platform_fixed_tariff_versions where draft_id=${id}`)).toBe('1')
}, 30000)
test.skipIf(!enabled)('конкурирующая дата: только одна публикация', async () => {
  const a=draft('date-a'), b=draft('date-b')
  const result=await race(publish('date-a-command',a,3),publish('date-b-command',b,3))
  expect(result.code).not.toBe(0)
  expect(result.err).toContain('duplicate key')
  expect(sql(`select count(*) from public.platform_fixed_tariff_versions where draft_id=${b}`)).toBe('0')
},30000)
test.skipIf(!enabled)('сохранение после конкурентной публикации запрещено', async () => {
  const id=draft('edit-race')
  const result=await race(publish('edit-publish',id,4),`select public.save_platform_tariff_draft(md5('edit-command')::uuid,${id},${source},1,'Changed',6,3,14)`)
  expect(result.code).not.toBe(0)
  expect(result.err).toContain('published draft is read only')
},30000)
test.skipIf(!enabled)('конкурентный отзыв идемпотентен и разблокирует черновик', async () => {
  const id=draft('revoke-race')
  sql(`${auth} ${publish('revoke-publish',id,5)};`)
  const version=sql(`select id from public.platform_fixed_tariff_versions where draft_id=${id}`)
  const command=`select public.revoke_tariff_publication(md5('revoke-command')::uuid,'${version}'::uuid)`
  const result=await race(command,command)
  expect(result.code).toBe(0)
  expect(sql(`select count(*) from public.platform_tariff_publication_commands where command_id=md5('revoke-command')::uuid`)).toBe('1')
  sql(`${auth} select public.save_platform_tariff_draft(md5('after-revoke')::uuid,${id},${source},1,'Editable',6,3,14);`)
},30000)



test.skipIf(!enabled)('разные команды не публикуют один черновик дважды', async () => {
  const id=draft('same-draft')
  const result=await race(publish('same-first',id,6),publish('same-second',id,7))
  expect(result.code).not.toBe(0)
  expect(result.err).toContain('draft already published')
  expect(sql(`select count(*) from public.platform_fixed_tariff_versions where draft_id=${id}`)).toBe('1')
},30000)
test.skipIf(!enabled)('сохранённая конкурентная правка отменяет устаревшую публикацию', async () => {
  const id=draft('stale-draft')
  const save=`select public.save_platform_tariff_draft(md5('stale-edit')::uuid,${id},${source},1,'New revision',6,3,14)`
  const result=await race(save,publish('stale-publish',id,8))
  expect(result.code).not.toBe(0)
  expect(result.err).toContain('draft revision conflict')
  expect(sql(`select count(*) from public.platform_fixed_tariff_versions where draft_id=${id}`)).toBe('0')
},30000)

test.skipIf(!enabled)('старая схема удаляется из БД без промодоступов', () => {
  expect(sql("select to_regclass('public.billing_promotions') is null")).toBe('t')
  expect(sql("select to_regprocedure('public.redeem_organization_promotion(uuid,text,uuid,bigint)') is null")).toBe('t')
  expect(sql("select to_regclass('public.billing_discount_codes') is not null")).toBe('t')
  expect(sql("select to_regprocedure('public.request_organization_trial(uuid,uuid,text,uuid,bigint)') is not null")).toBe('t')
})

test.skipIf(!enabled)('два заказа не расходуют последний льготный период', async () => {
  const org=sql("insert into public.organizations(name) values('Synthetic discount concurrency') returning id")
  sql(`insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
  values(md5('last-discount')::uuid,'${org}','pro',repeat('c',64),10000,1,1,now()+interval '1 day',md5('concurrency-owner')::uuid,gen_random_uuid());`)
  const reserve=n=>`reset role; select platform_private.reserve_discount_period(md5('discount-order-'||'${n}')::uuid,'${org}',md5('last-discount')::uuid,'pro',1,10000)`
  const result=await race(reserve(1),reserve(2))
  expect(result.code).not.toBe(0)
  expect(result.err).toContain('discount periods exhausted')
  expect(sql("select count(*) from public.billing_discount_reservations where discount_id=md5('last-discount')::uuid")).toBe('1')
  const retry=await race(reserve(1),reserve(1))
  expect(retry.code).toBe(0)
  expect(sql("select count(*) from public.billing_discount_reservations where discount_id=md5('last-discount')::uuid")).toBe('1')
},30000)

function paymentFixture(name, sent = false) {
  const org = sql(`insert into public.organizations(name) values('Synthetic payment ${name}') returning id`)
  sql(`insert into public.roles(key,name) values('owner','Synthetic owner') on conflict(key) do nothing;
insert into public.profiles(id) values(${owner}) on conflict(id) do nothing;
insert into public.roles(key,name) values('synthetic_billing','Synthetic billing') on conflict(key) do nothing;
insert into public.permissions(key,description) values('billing.manage','Synthetic') on conflict(key) do nothing;
insert into public.role_permissions select r.id,p.id from public.roles r,public.permissions p where r.key='synthetic_billing' and p.key='billing.manage' on conflict do nothing;
insert into public.organization_memberships(id,organization_id,user_id) values(md5('${name}-membership')::uuid,'${org}',${owner});
insert into public.membership_roles select md5('${name}-membership')::uuid,id from public.roles where key='synthetic_billing';
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id)
values(md5('${name}-code')::uuid,'${org}','pro',encode(extensions.digest(upper('CODE-${name}'),'sha256'),'hex'),5000,2,1,now()+interval '1 day',${owner},gen_random_uuid());`)
  sql(`insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until,period_months)
select md5('${name}-offer')::uuid,'${org}',${source},revision,10000,'123','https://stage.qvesta.ru',now(),((now() at time zone 'Europe/Moscow')+interval '1 month') at time zone 'Europe/Moscow',now()+interval '1 hour',1
from public.organization_subscriptions where organization_id='${org}';`)
  const id=sql(`select set_config('request.jwt.claim.sub',${owner}::text,false); select platform_private.accept_discount_checkout('${org}',md5('${name}-offer')::uuid,md5('${name}-command')::uuid,'CODE-${name}')->>'order_id';`).split('\n').at(-1)
  sql(`select platform_private.prepare_discount_payment('${id}'); insert into public.billing_sandbox_application_scope values('${org}');`)
  if(sent) sql(`select set_config('request.jwt.claim.sub',${owner}::text,false); select public.begin_sandbox_payment_send('${id}');`)
  sql(`insert into public.billing_sandbox_events(id,order_id,payment_id,event_type) values
(md5('${name}-success')::uuid,'${id}',md5('${name}-provider')::uuid,'payment.succeeded'),
(md5('${name}-cancel')::uuid,'${id}',md5('${name}-provider')::uuid,'payment.canceled');`)
  const event = success => `reset role; select public.apply_sandbox_payment_event(md5('${name}-${success?'success':'cancel'}')::uuid,jsonb_build_object('paymentId',md5('${name}-provider')::uuid,'status','${success?'succeeded':'canceled'}','paid',${success},'test',true))`
  return {id,org,event}
}

test.skipIf(!enabled)('отмена перед конкурентной отправкой запрещает POST', async()=>{
 const {id}=paymentFixture('cancel-before-send')
 const r=await race(`reset role; select platform_private.cancel_discount_payment('${id}',true)`,`reset role; select public.begin_sandbox_payment_send('${id}')`)
 expect(r.code).toBe(0);expect(r.out).toContain('"can_send": false')
 expect(sql(`select state from public.billing_discount_reservations where order_id='${id}'`)).toBe('released')
},30000)

test.skipIf(!enabled)('отправка перед конкурентной отменой сохраняет резерв', async()=>{
 const {id}=paymentFixture('send-before-cancel')
 const r=await race(`reset role; select public.begin_sandbox_payment_send('${id}')`,`reset role; select platform_private.cancel_discount_payment('${id}',true)`)
 expect(r.code).not.toBe(0);expect(r.err).toContain('requires reconciliation')
 expect(sql(`select state from public.billing_discount_reservations where order_id='${id}'`)).toBe('reserved')
},30000)

test.skipIf(!enabled)('одновременные подтверждения выдают один период', async()=>{
 const {id,event}=paymentFixture('double-success',true)
 const r=await race(event(true),event(true));expect(r.code).toBe(0);expect(r.out).toContain('applied')
 expect(sql(`select count(*) from public.billing_period_confirmations where confirmation_id='${id}'`)).toBe('1')
 expect(sql(`select state from public.billing_discount_reservations where order_id='${id}'`)).toBe('consumed')
},30000)

for(const firstSuccess of [false,true]) test.skipIf(!enabled)(`противоречивые события: первым ${firstSuccess?'успех':'отмена'}`,async()=>{
 const {id,event}=paymentFixture(firstSuccess?'success-first':'cancel-first',true)
 const r=await race(event(firstSuccess),event(!firstSuccess));expect(r.code).toBe(0);expect(r.out).toContain('review')
 expect(sql(`select state from public.billing_discount_reservations where order_id='${id}'`)).toBe(firstSuccess?'consumed':'released')
 expect(sql(`select count(*) from public.billing_period_confirmations where confirmation_id='${id}'`)).toBe(firstSuccess?'1':'0')
},30000)

test.skipIf(!enabled)('вставка и отзыв перестраивают номера, действующую версию нельзя отозвать',()=>{
 const base="md5('chronology-source')::uuid";
 sql(`insert into public.billing_plan_versions(id,plan_key,version,display_name,active_quests_limit,team_members_limit) values (${base},'chronology',1,'Chronology',1,1);
 insert into public.billing_tariff_timeline(version_id,catalog_version_id,plan_key,effective_at) values(${base},${base},'chronology',now()-interval '1 day');`);
 function make(name,days){
  sql(`${auth} select public.save_platform_tariff_draft(md5('${name}-save')::uuid,md5('${name}')::uuid,${base},0,'Chronology',2,2,14);`);
  sql(`${auth} ${publish(name+'-pub',"md5('"+name+"')::uuid",days)};`);
  return sql(`select id from public.platform_fixed_tariff_versions where draft_id=md5('${name}')::uuid`);
 }
 const later=make('chronology-later',100),earlier=make('chronology-earlier',90);
 expect(sql(`select platform_private.tariff_timeline_number('${later}')`)).toBe('3');
 expect(sql(`select platform_private.tariff_timeline_number('${earlier}')`)).toBe('2');
 sql(`${auth} select public.revoke_tariff_publication(md5('chronology-revoke')::uuid,'${earlier}');`);
 expect(sql(`select platform_private.tariff_timeline_number('${later}')`)).toBe('2');
 expect(sql(`select platform_private.tariff_timeline_number('${earlier}') is null`)).toBe('t');
 expect(()=>sql(`${auth} select public.revoke_tariff_publication(md5('chronology-current')::uuid,${base});`)).toThrow('publication cannot be revoked');
});
