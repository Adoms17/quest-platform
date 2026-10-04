// @vitest-environment node
import {test,expect} from 'vitest'
import {spawn,spawnSync} from 'node:child_process'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {randomUUID,randomBytes} from 'node:crypto'
import {buildStageBillingGuard} from './build-stage-billing-guard.js'
import {guardCatalogSql,buildGuardAdoption} from './build-billing-guard-adoption.js'
import {buildGuardRelease} from './build-stage-guard-release.js'
import {isolatedSandboxBootstrap} from './isolated-billing-bootstrap.js'
const enabled=process.env.QVESTA_TEST_PRODUCTION_BASELINE==='1'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
function assertIsolation(info,{id,owner,network,image,environment={}}){
 const require=(condition,message)=>{if(!condition)throw Error('Disposable container preflight: '+message)}
 require(info.Id===id && info.Config.Labels?.['qvesta.test.owner']===owner,'ownership mismatch')
 const host=info.HostConfig
 require(host.NetworkMode===network,'network mismatch')
 require(!host.PublishAllPorts && Object.keys(host.PortBindings||{}).length===0 &&
  Object.values(info.NetworkSettings?.Ports||{}).every(bindings=>bindings===null || bindings.length===0),'published ports')
 require(!host.Privileged && !host.PidMode && !host.IpcMode?.startsWith('host') && !host.CapAdd?.length && !host.Devices?.length,'host privileges')
 require(!host.Binds?.length && !host.Mounts?.length && !host.VolumesFrom?.length,'host or supplied mounts')
 require((host.RestartPolicy?.Name||'no')==='no','restart policy')
 require((info.Mounts||[]).every(m=>m.Type==='tmpfs' ||
  (m.Type==='volume' && /^[a-f0-9]{64}$/.test(m.Name) && Object.hasOwn(image.Volumes||{},m.Destination))),'unexpected volume')
 const envMap=values=>Object.fromEntries((values||[]).map(value=>{const i=value.indexOf('=');return [value.slice(0,i),value.slice(i+1)]}))
 const inherited=envMap(image.Env)
 require(!Object.entries(inherited).some(([key,value])=>value && /password|secret|token|credential|api.?key|private.?key/i.test(key)),'credential in image defaults')
 const expected={...inherited,...environment},actual=envMap(info.Config.Env)
 // Boolean comparison deliberately avoids dumping environment values on failure.
 require(Object.keys(actual).length===Object.keys(expected).length && Object.entries(expected).every(([key,value])=>actual[key]===value),'unexpected environment')
}

test('disposable preflight rejects shared resources and unexpected credentials without Docker',()=>{
 const id='a'.repeat(64),owner='unit-owner',image={Env:['PATH=/bin'],Volumes:{'/data':{}}}
 const options={id,owner,image,network:'none'}
 const clean={Id:id,Config:{Labels:{'qvesta.test.owner':owner},Env:['PATH=/bin']},
  HostConfig:{NetworkMode:'none',RestartPolicy:{Name:'no'}},NetworkSettings:{Ports:{}},
  Mounts:[{Type:'volume',Name:'b'.repeat(64),Destination:'/data'}]}
 expect(()=>assertIsolation(clean,options)).not.toThrow()
 for(const mutate of [
  x=>{x.Id='foreign'},x=>{x.Config.Labels={}},x=>{x.HostConfig.NetworkMode='bridge'},
  x=>{x.HostConfig.PortBindings={'5432/tcp':[{HostPort:'5432'}]}},
  x=>{x.NetworkSettings.Ports={'5432/tcp':[{HostPort:'5432'}]}},
  x=>{x.HostConfig.Binds=['/host:/data']},x=>{x.Mounts[0].Name='shared'},
  x=>{x.HostConfig.Privileged=true},x=>{x.Config.Env.push('ACCESS_TOKEN=synthetic-unexpected')},
 ]){const changed=structuredClone(clean);mutate(changed);expect(()=>assertIsolation(changed,options)).toThrow('Disposable container preflight')}
 expect(()=>assertIsolation(clean,{...options,image:{...image,Env:['PASSWORD=synthetic']}})).toThrow('credential in image defaults')
})
test.skipIf(!enabled)('production baseline 99 migrations preserves existing organization across historical chain',async()=>{
 const name='qvesta-release-test-'+randomUUID().replaceAll('-','');let databaseId,authId
 const ownedIds=[]
 const failures=[]
 const create=args=>{
  const id=docker(['create','--pull','never','--label','qvesta.test.owner='+name,...args]).trim()
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Docker did not return a full container ID')
  ownedIds.push(id);return id
 }
 const inspect=(id,network,environment={})=>{
  const info=JSON.parse(docker(['inspect',id]))[0]
  const image=JSON.parse(docker(['image','inspect',info.Image]))[0].Config
  assertIsolation(info,{id,owner:name,network,image,environment})
 }
 try{
  databaseId=create(['--network','none','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']);
  inspect(databaseId,'none')
  docker(['start',databaseId])
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',databaseId,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}if(!ready)throw Error('Postgres not ready')
  const sql=input=>docker(['exec','-i',databaseId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input)
  sql('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator; create role dashboard_user; create role supabase_read_only_user;')
  // Model observed API role switching and public schema privileges locally.
  // The container postgres stays superuser; this does not model hosted admin restrictions.
  sql(`alter role authenticator noinherit login;
   grant anon,authenticated,service_role to authenticator with inherit false;
   alter schema public owner to postgres;
   revoke all on schema public from public;
   grant usage on schema public to anon,authenticated;
   grant usage,create on schema public to service_role;`)
  // Fresh GoTrue schema in the isolated database; no shared local stack needed.
  sql('create schema auth; alter role postgres set search_path=auth,public;')
  const authEnvironment={
   GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',
   API_EXTERNAL_URL:'http://127.0.0.1',GOTRUE_SITE_URL:'http://127.0.0.1',
   GOTRUE_JWT_SECRET:randomBytes(48).toString('hex'),GOTRUE_LOG_LEVEL:'fatal'}
  // Only explicitly generated local values enter the container; no host env forwarding.
  // Suppress create diagnostics because argv includes a synthetic JWT secret.
  try{
   authId=create(['--name',name+'-auth','--network','container:'+databaseId,
    ...Object.entries(authEnvironment).flatMap(([key,value])=>['-e',key+'='+value]),
    'supabase/gotrue:v2.196.0','auth','migrate'])
  }catch{throw Error('Isolated Auth container creation failed')}
  inspect(authId,'container:'+databaseId,authEnvironment)
  inspect(databaseId,'none')
  const authResult=spawnSync('docker',['start','--attach',authId],{encoding:'utf8',timeout:60000,windowsHide:true})
  // Auth diagnostics may include connection settings; do not print them.
  if(authResult.status!==0)throw Error('Isolated Auth schema migration failed')
  inspect(authId,'container:'+databaseId,authEnvironment)
  const authState=JSON.parse(docker(['inspect','--format','{{json .State}}',authId]))
  expect(authState.Status).toBe('exited')
  expect(authState.ExitCode).toBe(0)
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
  // Observed production defaults on 2026-10-01; applied ONLY inside this disposable container.
  // These precede historical migrations so their REVOKE/GRANT statements remain authoritative.
  sql(`alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
   alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
   alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`)
  sql(base.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  const inventorySql=readFileSync(new URL('./inspect-production-baseline-catalog.sql',import.meta.url),'utf8')
  const inventory=JSON.parse(sql(inventorySql).trim())
  const observed=JSON.parse(readFileSync(new URL('../docs/tasks/PROD-PAY-05-production-catalog-20261001.json',import.meta.url),'utf8'))
  for(const [category,fingerprint] of Object.entries(observed))expect(inventory[category],category+' matches production snapshot').toEqual(fingerprint)
  for(const role of ['anon','authenticated','service_role']){
   expect(sql(`select has_schema_privilege('${role}','public','USAGE')`).trim()).toBe('t')
   expect(sql(`select has_schema_privilege('${role}','public','CREATE')`).trim()).toBe(role==='service_role'?'t':'f')
   expect(sql(`select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolcanlogin from pg_roles where rolname='${role}'`).trim()).toBe('f')
   expect(sql(`select rolbypassrls from pg_roles where rolname='${role}'`).trim()).toBe(role==='service_role'?'t':'f')
   expect(sql(`select count(*) from pg_auth_members where member=(select oid from pg_roles where rolname='${role}')`).trim()).toBe('0')
   expect(sql(`select set_option and not inherit_option and not admin_option from pg_auth_members where member=(select oid from pg_roles where rolname='authenticator') and roleid=(select oid from pg_roles where rolname='${role}')`).trim()).toBe('t')
  }
  expect(sql("select has_schema_privilege('authenticator','public','USAGE')").trim()).toBe('f')
  expect(sql("select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','platform_private') and a.attnum>0 and not a.attisdropped and a.attacl is not null").trim()).toBe('0')
  // Prove the inventory detects permission/RLS drift and the rollback restores the fixture.
  const changed=JSON.parse(sql(inventorySql.replace('begin read only;',`begin;
   alter table public.organizations disable row level security;
   grant select on public.organizations to public;`)).trim())
  expect(changed.relations.md5).not.toBe(inventory.relations.md5)
  expect(changed.relation_acl.md5).not.toBe(inventory.relation_acl.md5)
  expect(JSON.parse(sql(inventorySql).trim())).toEqual(inventory)
  expect(inventory.relations.count).toBeGreaterThan(0)
  expect(inventory.policies.count).toBeGreaterThan(0)
  expect(inventory.functions.count).toBeGreaterThan(0)
  if(process.env.QVESTA_BASELINE_INVENTORY_OUTPUT)writeFileSync(process.env.QVESTA_BASELINE_INVENTORY_OUTPUT,JSON.stringify(inventory,null,2)+'\n')
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
  const quiescence=JSON.parse(sql(readFileSync(new URL('./inspect-stage-billing-quiescence.sql',import.meta.url),'utf8')).trim())
  expect(quiescence).toEqual({edge_drain_verified:false,active_cron_jobs:0,active_reconciliation_leases:0,order_states:{},refund_states:{},fiscal_states:{},enabled_settlement_schedules:0})
  // Exercise the exact offline bundle inside a disposable database, never stage.
  const bundle=buildStageBillingGuard({projectRef:'jeugfyaqzfgdvfhdxfht'})
  const originalCatalog=JSON.parse(sql(inventorySql).trim())
  const rehearsal=bundle.replace(/^commit;\s*$/m,`select 'stage_bundle_initialized=' || environment from platform_private.billing_runtime_environment;
   rollback;`)
  expect(sql(rehearsal)).toContain('stage_bundle_initialized=sandbox')
  expect(JSON.parse(sql(inventorySql).trim())).toEqual(originalCatalog)
  expect(sql("select to_regclass('platform_private.billing_runtime_environment') is null").trim()).toBe('t')


  // Adoption must recognize the exact manually installed package, without provisioning.
  const guardCatalog=guardCatalogSql()
  const expectedGuard=JSON.parse(sql(bundle.replace(/commit;\s*$/,'')+
   'set local search_path=pg_catalog;'+guardCatalog+'; rollback;').trim())
  const adoption=buildGuardAdoption(expectedGuard)
  const adoptionBody=adoption.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
  const fresh=sql('begin;'+adoptionBody+
   "select 'unconfigured='||count(*) from platform_private.billing_runtime_environment; rollback;")
  expect(fresh).toContain('unconfigured=0')
  expect(JSON.parse(sql(inventorySql).trim())).toEqual(originalCatalog)
  const installed=bundle.replace(/commit;\s*$/,'')
  const adopted=sql(installed+adoptionBody+adoptionBody+
   "select 'preserved='||environment from platform_private.billing_runtime_environment;rollback;")
  expect(adopted).toContain('preserved=sandbox')
  for(const mutation of [
   'alter table platform_private.billing_runtime_environment disable row level security;',
   'grant select on platform_private.billing_runtime_environment to authenticated;',
   'alter table platform_private.billing_runtime_environment disable trigger billing_environment_identity_immutable;',
   'alter table platform_private.billing_runtime_environment add column unexpected text;',
   'alter table platform_private.billing_runtime_environment drop constraint billing_runtime_environment_environment_check;',
   'grant execute on function platform_private.require_sandbox_environment() to service_role;',
   "create or replace function platform_private.require_sandbox_environment() returns void language plpgsql security definer set search_path='' as $$begin return; end;$$;",
   "alter function public.begin_sandbox_payment_send(uuid) security invoker;",
   "create policy unexpected on platform_private.billing_runtime_environment for select to authenticated using(true);",
  ]){
   expect(()=>sql(installed+mutation+adoptionBody+'rollback;')).toThrow('billing guard catalog mismatch')
   expect(JSON.parse(sql(inventorySql).trim())).toEqual(originalCatalog)
  }
  expect(()=>sql("begin;create function platform_private.require_sandbox_environment() returns void language sql as $$select$$;"+adoptionBody+'rollback;')).toThrow('billing guard partial installation')

  const crlfMutation="do $crlf$ declare source text; definition text; begin select prosrc into source from pg_proc where oid='platform_private.require_sandbox_environment()'::regprocedure; definition:=pg_get_functiondef('platform_private.require_sandbox_environment()'::regprocedure); execute replace(definition,source,replace(source,chr(10),chr(13)||chr(10))); end; $crlf$;"
  expect(sql(installed+crlfMutation+adoptionBody+"select 'crlf_accepted';rollback;")).toContain('crlf_accepted')
  expect(()=>sql('begin;'+adoptionBody+'select platform_private.require_sandbox_environment();rollback;')).toThrow('sandbox environment denied')

  if(process.env.QVESTA_GUARD_ADOPTION_OUTPUT)writeFileSync(process.env.QVESTA_GUARD_ADOPTION_OUTPUT,adoption)


  // Execute the versioned artifact, not only the generator.
  const versionedGuard=readFileSync(new URL('../supabase/release-migrations/20261003000000_adopt_billing_environment_guard.sql',import.meta.url),'utf8')
  expect(versionedGuard).toBe(adoption)
  expect(sql(versionedGuard.replace(/commit;\s*$/,'')+
   "select 'fresh_empty='||count(*) from platform_private.billing_runtime_environment;rollback;")).toContain('fresh_empty=0')
  const freshBootstrap=sql(versionedGuard.replace(/commit;\s*$/,'')+isolatedSandboxBootstrap(name)+isolatedSandboxBootstrap(name)+"select 'sandbox_ready='||environment from platform_private.billing_runtime_environment;rollback;")
  expect(freshBootstrap).toContain('sandbox_ready=sandbox')
  const release=buildGuardRelease({projectRef:'jeugfyaqzfgdvfhdxfht',mode:'apply'})
  const releaseBody=release.replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,'')
  const historySetup="create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);"+
   "insert into supabase_migrations.schema_migrations(version) values "+files.map(f=>"('"+f.slice(0,14)+"')").join(',')+";"
  const recorded=sql(installed+historySetup+releaseBody+releaseBody+
   "select 'recorded='||count(*) from supabase_migrations.schema_migrations where version='20261003000000';rollback;")
  expect(recorded).toContain('recorded=1')
  expect(()=>sql(installed+historySetup+"delete from supabase_migrations.schema_migrations where version='20260914210000';"+releaseBody+'rollback;')).toThrow('guard release history mismatch')
  expect(()=>sql(installed+historySetup+"insert into supabase_migrations.schema_migrations(version) values('20990101000000');"+releaseBody+'rollback;')).toThrow('guard release history mismatch')
  expect(()=>sql(installed+historySetup+releaseBody+"update supabase_migrations.schema_migrations set statements=array['select 1'] where version='20261003000000';"+releaseBody+'rollback;')).toThrow('guard release recorded content mismatch')
  expect(()=>sql(installed+historySetup+"alter table platform_private.billing_runtime_environment disable row level security;"+releaseBody+'rollback;')).toThrow('billing guard catalog mismatch')
  expect(()=>sql(installed+historySetup+releaseBody+"do $$begin raise exception 'injected release failure';end;$$;commit;")).toThrow('injected release failure')
  expect(JSON.parse(sql(inventorySql).trim())).toEqual(originalCatalog)

  // Rehearse the exact post-guard fixture only inside this disposable database.
  const postGuardBody=readFileSync(new URL('./stage-post-guard-fixture.sql',import.meta.url),'utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'')
  const postGuardSetup=bundle.replace(/commit;\s*$/,'')+" \n insert into auth.users(id,email) values(md5('operator-fixture-owner')::uuid,'operator@example.test');\n insert into public.platform_access_assignments(user_id,role_key,scope_kind) values(md5('operator-fixture-owner')::uuid,'owner','platform');\n select set_config('test.personal.before',(select to_jsonb(s)::text from public.organization_subscriptions s join public.organizations o on o.id=s.organization_id where o.personal_owner_id=md5('operator-fixture-owner')::uuid),true);\n insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode)\n values(md5('operator-policy')::uuid,'sandbox','1467641',clock_timestamp()+interval '1 second',1,'service','full_prepayment');\n insert into public.billing_fiscal_policy_models(policy_id,product_kind,model_version,seller_tax_regime,settlement_basis)\n values(md5('operator-policy')::uuid,'subscription','subscription_access_v1','ausn','period_end'); select pg_sleep(1.1);\n "
  const fixtureQuery="select to_jsonb(f)::text from public.billing_fiscal_acceptance_fixtures f where id=md5('stage-guard-fixture-20261002')::uuid"
  const fixtureOut=sql(postGuardSetup+postGuardBody+`
   select set_config('test.saved.fixture', (${fixtureQuery}),true);
   ${postGuardBody}
   do $verify$ begin
    if (${fixtureQuery}) is distinct from current_setting('test.saved.fixture') then raise exception 'fixture retry changed row'; end if;
    if exists(select 1 from public.billing_sandbox_orders) then raise exception 'fixture created payment'; end if;
   end; $verify$;
   select 'post_guard_fixture_retry_ok'; rollback;`)
  expect(fixtureOut).toContain('post_guard_fixture_retry_ok')
  expect(sql("select count(*) from public.organizations where id=md5('stage-guard-org-20261002')::uuid").trim()).toBe('0')
  expect(()=>sql(postGuardSetup+postGuardBody.replace("clock_timestamp()+interval '2 hours'","clock_timestamp()-interval '1 second'")+postGuardBody+'rollback;')).toThrow('fixture already used, expired or mismatched')
  expect(()=>sql(postGuardSetup+`insert into public.organizations(id,name) values(md5('stage-guard-org-20261002')::uuid,'existing test organization');`+postGuardBody+'rollback;')).toThrow('organization collision: preserve existing organization')
  expect(()=>sql(postGuardSetup+postGuardBody+`select public.prepare_fiscal_acceptance_from_gateway(md5('operator-fixture-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+300,md5('stage-guard-fixture-20261002')::uuid,'operator@example.test');`+postGuardBody+'rollback;')).toThrow('fixture already used, expired or mismatched')
  expect(sql("select to_regclass('platform_private.billing_runtime_environment') is null").trim()).toBe('t')
  const failedBundle=bundle.replace(/^commit;\s*$/m,`do $failure$ begin raise exception 'injected stage bundle failure'; end; $failure$; commit;`)
  expect(()=>sql(failedBundle)).toThrow('injected stage bundle failure')
  expect(sql("select to_regclass('platform_private.billing_runtime_environment') is null").trim()).toBe('t')
  expect(JSON.parse(sql(inventorySql).trim())).toEqual(originalCatalog)
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
  // Inspect final ACL after all historical rewrites and sandbox guards.
  const serverGateways=[
   'public.sandbox_checkout_from_gateway(uuid,text,uuid,jsonb)',
   'public.sandbox_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb)',
   'public.subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,jsonb)',
   'public.prepare_subscription_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid,uuid)',
   'public.prepare_linked_fiscal_refund_from_gateway(uuid,bigint,bigint,text,uuid,uuid,uuid)',
   'public.subscription_fiscal_refund_from_gateway(uuid,bigint,bigint,text,text,uuid,jsonb)',
   'public.prepare_fiscal_acceptance_from_gateway(uuid,bigint,bigint,uuid,text)',
   'public.subscription_fiscal_worker_gateway(text,text,uuid,uuid,jsonb)',
   'public.subscription_fiscal_order_worker_gateway(text,uuid,text,uuid,uuid,jsonb)',
  ]
  for(const gateway of serverGateways){
   for(const role of ['anon','authenticated','service_role'])expect(sql(`select has_function_privilege('${role}','${gateway}','EXECUTE')`).trim(),role+' '+gateway).toBe(role==='service_role'?'t':'f')
   expect(sql(`select not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='${gateway}'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')`).trim(),'PUBLIC cannot execute '+gateway).toBe('t')
  }
  for(const suite of ['platform_access','platform_command_confirmation','platform_assignment_commands']){
   const output=sql('set search_path=public,extensions;'+readSuite(suite))
   expect(output,suite).not.toMatch(/not ok|Looks like/)
   expect(output,suite).toMatch(/^1\.\.\d+/m)
  }

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
  const recoverySource=readSuite('subscription_refund_result')
  const recoveryMarker="select is(platform_private.prepare_subscription_refund_recovery(current_setting('test.reserve')::uuid)->>'action','retry_same_request'"
  const recoveryChecks=`
   select set_config('test.recovery.before',(select to_jsonb(r)::text from public.billing_sandbox_refunds r where id=current_setting('test.reserve')::uuid),true);
   update platform_private.billing_runtime_environment set environment='production';
   select throws_ok($deny$select platform_private.prepare_subscription_refund_recovery(current_setting('test.reserve')::uuid)$deny$,'42501','sandbox environment denied','production denies refund retry');
   set local role service_role;
   select throws_ok($deny$select public.subscription_refund_from_gateway(md5('subscription-refund-owner')::uuid,floor(extract(epoch from clock_timestamp()))::bigint,floor(extract(epoch from clock_timestamp()))::bigint+300,'recover',current_setting('test.reserve')::uuid)$deny$,'42501','sandbox environment denied','gateway denies production refund retry');
   reset role;
   delete from platform_private.billing_runtime_environment;
   select throws_ok($deny$select platform_private.prepare_subscription_refund_recovery(current_setting('test.reserve')::uuid)$deny$,'42501','sandbox environment denied','unknown environment denies refund retry');
   select is((select to_jsonb(r)::text from public.billing_sandbox_refunds r where id=current_setting('test.reserve')::uuid),current_setting('test.recovery.before'),'retry denial preserves refund');
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  `
  const readMarker="select is(platform_private.prepare_subscription_refund_recovery(current_setting('test.reserve')::uuid)->>'action','read_provider','known provider identity uses read only');"
  expect(recoverySource.split(recoveryMarker)).toHaveLength(2)
  expect(recoverySource.split(readMarker)).toHaveLength(2)
  const recoveryGuarded=recoverySource.replace(recoveryMarker,recoveryChecks+recoveryMarker).replace(readMarker,`
   update platform_private.billing_runtime_environment set environment='production';
   ${readMarker}
   delete from platform_private.billing_runtime_environment;
   ${readMarker}
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  `)
  const applyMarker="select is(pg_temp.result('succeeded')->>'access_state','applied','verified success applies access');"
  expect(recoveryGuarded.split(applyMarker)).toHaveLength(2)
  const applicationDenials=`
   select set_config('test.apply.refund',(select to_jsonb(r)::text from public.billing_sandbox_refunds r where id=current_setting('test.reserve')::uuid),true);
   select set_config('test.apply.subscription',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
   update platform_private.billing_runtime_environment set environment='production';
   select throws_ok($deny$select pg_temp.result('succeeded')$deny$,'42501','sandbox environment denied','production rejects verified refund access application');
   delete from platform_private.billing_runtime_environment;
   select throws_ok($deny$select pg_temp.result('succeeded')$deny$,'42501','sandbox environment denied','unknown environment rejects verified refund access application');
   select is((select to_jsonb(r)::text from public.billing_sandbox_refunds r where id=current_setting('test.reserve')::uuid),current_setting('test.apply.refund'),'denied application rolls back refund status');
   select is((select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.apply.subscription'),'denied application preserves access');
   select is((select count(*) from public.subscription_refund_applications where refund_id=current_setting('test.reserve')::uuid),0::bigint,'denied application creates no audit');
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  `
  const replayDenials=`
   select set_config('test.applied.subscription',(select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),true);
   update platform_private.billing_runtime_environment set environment='production';
   set local role service_role;
   select throws_ok($deny$select public.retry_sandbox_subscription_refund_application('123',current_setting('test.reserve')::uuid)$deny$,'42501','sandbox environment denied','production rejects completed refund replay');
   reset role;
   delete from platform_private.billing_runtime_environment;
   set local role service_role;
   select throws_ok($deny$select public.retry_sandbox_subscription_refund_application('123',current_setting('test.reserve')::uuid)$deny$,'42501','sandbox environment denied','unknown environment rejects completed refund replay');
   reset role;
   select is((select to_jsonb(s)::text from public.organization_subscriptions s where organization_id=current_setting('test.org')::uuid),current_setting('test.applied.subscription'),'denied replay preserves applied access');
   select is((select count(*) from public.subscription_refund_applications where refund_id=current_setting('test.reserve')::uuid),1::bigint,'denied replay preserves single application');
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  `
  const accessGuarded=recoveryGuarded.replace(applyMarker,applicationDenials+applyMarker+replayDenials)
  const recoveryOutput=sql('set search_path=public,extensions;'+accessGuarded)
  expect(recoveryOutput).toContain('denied application rolls back refund status')
  expect(recoveryOutput).toContain('denied replay preserves single application')
  expect(recoveryOutput).not.toMatch(/not ok|Looks like/)
  expect(recoveryOutput).toContain('gateway denies production refund retry')
  expect(recoveryOutput).toContain('retry denial preserves refund')
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
  const workerSource=readSuite('subscription_fiscal_worker')
  const sendMarker="select is(public.subscription_fiscal_worker_gateway('123','before_send'"
  const sendDenials=`
   reset role;
   select set_config('test.send.before',(select to_jsonb(s)::text from public.billing_subscription_fiscal_operation_status s where command_id=(current_setting('test.worker.claim')::jsonb->>'commandId')::uuid),true);
   update platform_private.billing_runtime_environment set environment='production';
   set local role service_role;
   select throws_ok($deny$select public.subscription_fiscal_worker_gateway('123','before_send',null,(current_setting('test.worker.claim')::jsonb->>'commandId')::uuid,current_setting('test.worker.claim')::jsonb)$deny$,'42501','sandbox environment denied','production denies persisted send reauthorization');
   select throws_ok($deny$select public.subscription_fiscal_order_worker_gateway('123',current_setting('test.payment')::uuid,'before_send',null,(current_setting('test.worker.claim')::jsonb->>'commandId')::uuid,current_setting('test.worker.claim')::jsonb)$deny$,'42501','sandbox environment denied','scoped worker denies persisted send reauthorization');
   reset role;
   delete from platform_private.billing_runtime_environment;
   set local role service_role;
   select throws_ok($deny$select public.subscription_fiscal_worker_gateway('123','before_send',null,(current_setting('test.worker.claim')::jsonb->>'commandId')::uuid,current_setting('test.worker.claim')::jsonb)$deny$,'42501','sandbox environment denied','unknown environment denies persisted send reauthorization');
   reset role;
   select is((select to_jsonb(s)::text from public.billing_subscription_fiscal_operation_status s where command_id=(current_setting('test.worker.claim')::jsonb->>'commandId')::uuid),current_setting('test.send.before'),'send denials preserve operation');
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
   set local role service_role;
  `
  expect(workerSource.split(sendMarker)).toHaveLength(2)
  const guardedWorker=workerSource.replace(sendMarker,sendDenials+sendMarker)
  const workerSql=paid.replace('select * from finish();rollback;',()=>readSuite('platform_order_documents')+'\n'+modeledPrefix+'\n'+resultPrefix+'\n'+guardedWorker+'\nselect * from finish();rollback;')
  expect(workerSql).not.toBe(paid)
  const workerOutput=sql('set search_path=public,extensions;'+withHistoryPreflight(workerSql,['billing_receipt_snapshots','billing_subscription_fiscal_operations','billing_sandbox_orders']))
  expect(workerOutput).not.toMatch(/not ok|Looks like/)
  expect(workerOutput).toContain('send denials preserve operation')
  expect(workerOutput).toContain('payment receipt history includes exact settled remainder')
  expect(workerOutput).toMatch(/^1\.\.\d+/m)
  const asyncSql=input=>new Promise((resolve,reject)=>{
   const child=spawn('docker',['exec','-i',databaseId,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true})
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
  sql(readFileSync(new URL('../supabase/release-migrations/20261003010000_read_my_platform_sections.sql',import.meta.url),'utf8'))
  sql(readFileSync(new URL('../supabase/tests/database/platform_sections.test.sql',import.meta.url),'utf8'))
  // Last fixture deliberately commits. Every sql() opens a new psql session;
  // only disposal of this test's own container cleans up committed synthetic data.
  {
  const binding=readSuite('subscription_fiscal_refund_binding').split('-- LINKED_LIFECYCLE_CHECKS')
  expect(binding).toHaveLength(2)
  const persistenceFixture=paid.replace('select * from finish();rollback;',()=>
   readSuite('platform_order_documents')+'\n'+modeledPrefix+'\n'+binding[0]+'\n'+
   readSuite('subscription_fiscal_presend_commit'))
  expect(persistenceFixture).not.toBe(paid)
  const committed=sql('set search_path=public,extensions;'+persistenceFixture)
  expect(committed).not.toMatch(/not ok|Looks like/)
  expect(committed).toMatch(/^1\.\.\d+/m)
  const claimLines=committed.split(/\r?\n/).filter(line=>line.startsWith('PRESEND_CLAIM|'))
  expect(claimLines).toHaveLength(1)
  const claim=JSON.parse(claimLines[0].slice('PRESEND_CLAIM|'.length))
  expect(claim.action).toBe('send')
  expect(claim.commandId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
  expect(claim.key).toBeTruthy()
  expect(claim.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(claim.firstSentAt).toBeTruthy()
  const tables=['billing_sandbox_orders','billing_sandbox_payment_results','billing_sandbox_refunds',
   'billing_subscription_fiscal_ledgers','billing_subscription_fiscal_operations',
   'billing_subscription_fiscal_operation_status','subscription_refund_requests',
   'subscription_refund_dispatches','subscription_refund_period_bindings','subscription_refund_reservations',
   'subscription_refund_applications','organization_subscriptions','billing_period_confirmations',
   'billing_review_resolutions']
  const snapshot=()=>JSON.parse(sql(`select jsonb_build_object(${tables.map(table=>
   `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`
  ).join(',')})`).trim())
  const before=snapshot()
  expect(before.subscription_refund_requests).toHaveLength(1)
  expect(before.subscription_refund_requests[0].id).toBe(claim.commandId)
  expect(before.subscription_refund_reservations).toHaveLength(1)
  expect(before.subscription_refund_reservations[0]).toMatchObject({
   request_id:claim.commandId,refund_id:before.billing_sandbox_refunds[0]?.id})
  expect(before.billing_sandbox_refunds[0]?.fiscal_command_id).toBe(claim.commandId)
  expect(before.subscription_refund_dispatches).toHaveLength(1)
  expect(before.subscription_refund_applications).toHaveLength(0)
  expect(before.billing_subscription_fiscal_operation_status).toHaveLength(1)
  expect(before.billing_subscription_fiscal_operation_status[0]).toMatchObject({state:'unknown',requires_review:false})
  expect(before.billing_sandbox_refunds).toHaveLength(1)
  expect(before.billing_sandbox_refunds[0]).toMatchObject({state:'sending'})
  const epoch='floor(extract(epoch from clock_timestamp()))::bigint'
  const quote=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb"
  const gateway=(action,mfa=epoch,exp=epoch+'+300',expected=claim)=>
   `public.subscription_fiscal_refund_from_gateway(md5('discount-checkout-owner')::uuid,${mfa},${exp},'123','${action}','${claim.commandId}'::uuid,${quote(expected)})`
  const call=expression=>JSON.parse(sql(`begin;set local role service_role;select ${expression};commit;`).trim())
  // A successful control establishes that refusals are not a broken fixture/ACL.
  expect(call(gateway('before_send'))).toMatchObject({authorized:true,key:claim.key,sha256:claim.sha256})
  expect(snapshot()).toEqual(before)
  for(const scenario of [
   {name:'expired identity with fresh MFA',mfa:epoch,exp:epoch+'-1',state:'42501'},
   {name:'stale MFA with valid identity',mfa:epoch+'-301',exp:epoch+'+300',state:'42501'},
   {name:'wrong saved hash',mfa:epoch,exp:epoch+'+300',state:'55000',expected:{...claim,sha256:'0'.repeat(64)}},
  ]){
   expect(()=>sql('\\set VERBOSITY sqlstate\n'+`begin;set local role service_role;select ${
    gateway('before_send',scenario.mfa,scenario.exp,scenario.expected||claim)};commit;`),scenario.name)
    .toThrow(new RegExp('ERROR:\\s+'+scenario.state))
   expect(snapshot(),scenario.name+' leaves committed claim unchanged in a new session').toEqual(before)
   expect(call(gateway('status')),scenario.name+' status').toMatchObject({
    state:'sending',operationState:'unknown',requiresReview:false,accessEffect:'not_applied'})
   expect(call(gateway('claim')),scenario.name+' retry cannot dispatch twice').toMatchObject({
    action:'reconcile',key:claim.key,sha256:claim.sha256,firstSentAt:claim.firstSentAt})
   expect(snapshot(),scenario.name+' retry preserves all rows including single dispatch').toEqual(before)
  }
  }
 }catch(error){failures.push(error)}finally{
  // IDs came only from successful creates in this invocation. -v removes their
  // anonymous image volumes; no volume prune, named-volume delete or name lookup.
  for(const id of ownedIds.reverse()){
   try{docker(['rm','-f','-v',id])}catch{failures.push(Error('Own container cleanup failed: '+id))}
  }
 }
 if(failures.length)throw new AggregateError(failures,'Disposable baseline test or cleanup failed')
},180000)
