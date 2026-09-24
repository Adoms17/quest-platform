// @vitest-environment node
import {test,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {verifyRecurringConcurrency,verifyDispatchConcurrency} from './recurring-concurrency.mjs'
import {verifyTrialCheckoutConcurrency} from './trial-checkout-concurrency.mjs'
import {verifyPlatformRefundConcurrency} from './platform-refund-concurrency.mjs'
import {verifyRecurringPostgrest} from './recurring-postgrest.mjs'
const enabled=process.env.QVESTA_TEST_TARIFF_RELEASE==='1'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
test.skipIf(!enabled)('чистая схема staging → 81 миграций тарифного релиза',async()=>{
 const name='qvesta-release-test-'+randomUUID().replaceAll('-','');let created=false
 try{
  docker(['run','-d','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']);created=true
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}if(!ready)throw Error('Postgres not ready')
  const sql=input=>docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input)
  sql('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator; create role dashboard_user; create role supabase_read_only_user;')
  // Только схема Auth, без аккаунтов, данных приложения и настроек доступа.
  const auth=docker(['exec','supabase_db_quest-platform','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--schema=auth','--no-publications','--no-subscriptions'])
  sql(auth.replace(/^CREATE TRIGGER[^;]*EXECUTE FUNCTION public\.[^;]*;/gm,'').replace(/^ALTER DEFAULT PRIVILEGES[^;]*;/gm,''))
  const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()
  const release=files.filter(f=>f>='20260919020000'),base=files.filter(f=>f<'20260919020000')
  sql(base.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  // Контракт промежуточного frontend: trial и восстановление работают до и после миграций.
  function bridgeContract(){
   const output=sql(`begin;
insert into auth.users(id,email) values(md5('bridge-contract')::uuid,'bridge-contract@example.test');
select set_config('request.jwt.claim.sub',md5('bridge-contract')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
set local role authenticated;
select jsonb_build_object('bridge_controls',public.get_organization_free_access_controls(current_setting('test.org')::uuid,repeat('b',64)));
select public.request_organization_trial(current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),repeat('b',64),md5('bridge-request')::uuid,0);
select jsonb_build_object('bridge_receipt',public.get_free_access_command_result(current_setting('test.org')::uuid,'trial',md5('bridge-request')::uuid));
rollback;`)
   const records=output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
   const controls=records.find(r=>r.bridge_controls)?.bridge_controls,receipt=records.find(r=>r.bridge_receipt)?.bridge_receipt
   expect(controls).toMatchObject({available:true,revision:0});expect(controls.targets.length).toBeGreaterThan(0)
   expect(receipt).toMatchObject({found:true,receipt:{state:'active'}})
  }
  sql('grant usage on schema extensions to authenticated,anon,service_role;')
  bridgeContract()
  const removal=readFileSync(new URL('20260920080000_remove_legacy_promotions.sql',dir),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,'')
  expect(()=>sql(`begin;
insert into auth.users(id,email) values(md5('legacy-guard')::uuid,'legacy-guard@example.test');
select set_config('request.jwt.claim.sub',md5('legacy-guard')::uuid::text,true);
select set_config('test.org',(select id::text from public.organizations where personal_owner_id=auth.uid()),true);
select set_config('test.promo',public.issue_organization_promotion(current_setting('test.org')::uuid,(select id from public.billing_plan_versions where plan_key='pro' and version=1),14,now()+interval '1 day',auth.uid(),gen_random_uuid())::text,true);
select public.redeem_organization_promotion(current_setting('test.org')::uuid,current_setting('test.promo')::jsonb->>'code',gen_random_uuid(),0);
${removal}`)).toThrow('legacy promotion access must be resolved before removal')
  sql(release.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  expect(release).toHaveLength(81)
  await verifyPlatformRefundConcurrency(name,sql)
  bridgeContract()
  sql('create extension pgtap with schema extensions; grant usage on schema extensions to authenticated,anon,service_role;')
  const suites=readdirSync(new URL('../supabase/tests/database/',import.meta.url)).filter(f=>/^(billing_discount.*|billing_sandbox_renewal|billing_sandbox_schedule|billing_recurring_.*|billing_refunded_duplicate|billing_trial.*|billing_tariff.*|billing_promotions|billing_free_access_controls|platform_tariff.*|platform_fixed_tariffs|platform_discount_.*|platform_payment_catalog)\.test\.sql$/.test(f))
  const cleanSuites=suites.filter(f=>!f.startsWith('platform_discount_'))
  for(const file of cleanSuites){const result=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/'+file,import.meta.url),'utf8'));expect(result,file).not.toMatch(/^not ok /m);expect(result,file).toMatch(/^1\.\.\d+/m)}
  // Посторонние записи должны пережить каждый транзакционный SQL-набор.
  sql(`insert into auth.users(id,email) values(md5('unrelated-release-owner')::uuid,'unrelated-release@example.test');
insert into public.platform_discount_campaigns(id,title,plan_key,discount_bps,eligible_periods,period_months,starts_at,activate_before,state,approved_by,approved_at)
values(md5('unrelated-release-campaign')::uuid,'Unrelated fixture','pro',2500,2,1,now()-interval '1 day',now()+interval '100 days','approved',md5('unrelated-release-owner')::uuid,now());
insert into public.billing_discount_codes(id,organization_id,plan_key,code_hash,discount_bps,eligible_periods,period_months,activate_before,issuer_id,issue_command_id,campaign_id)
select md5('unrelated-release-code')::uuid,id,'pro',encode(extensions.digest('UNRELATED-FIXTURE','sha256'),'hex'),2500,2,1,now()+interval '100 days',personal_owner_id,md5('unrelated-release-command')::uuid,md5('unrelated-release-campaign')::uuid from public.organizations where personal_owner_id=md5('unrelated-release-owner')::uuid;`)
  const snapshot=()=>sql(`select jsonb_build_object('campaign',(select to_jsonb(c) from public.platform_discount_campaigns c where id=md5('unrelated-release-campaign')::uuid),'code',(select to_jsonb(c) from public.billing_discount_codes c where id=md5('unrelated-release-code')::uuid))`)
  const before=snapshot()
  const stageSuites=suites.filter(f=>f.startsWith('billing_discount')||f.startsWith('billing_trial_full_price')||['billing_trial_timeline.test.sql','platform_tariff_support_end.test.sql','platform_tariff_source_version.test.sql'].includes(f))
  for(const file of stageSuites){
   const result=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/'+file,import.meta.url),'utf8'))
   expect(result,file).not.toMatch(/^not ok /m);expect(result,file).toMatch(/^1\.\.\d+/m)
   expect(snapshot(),file+' preserves unrelated records').toBe(before)
  }
  for(const file of [...suites.filter(f=>f.startsWith('platform_discount_')),...suites.filter(f=>f.startsWith('platform_discount_'))]){
   const f=file.replace('.test.sql','')
   let result;try{result=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/'+f+'.test.sql',import.meta.url),'utf8'))}catch(error){throw new Error(f+': '+error.message,{cause:error})}
   expect(result,f).not.toMatch(/^not ok /m);expect(result,f).toMatch(/^1\.\.\d+/m)
  }
  expect(snapshot()).toBe(before)
  await verifyTrialCheckoutConcurrency(name,sql)
  await verifyRecurringConcurrency(name,sql)
  await verifyDispatchConcurrency(name,sql)
  await verifyRecurringPostgrest(name,sql)
 }finally{if(created&&/^qvesta-release-test-[a-f0-9]{32}$/.test(name))docker(['rm','-f',name])}
},420000)
