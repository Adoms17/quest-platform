// @vitest-environment node
import {test,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {randomUUID,randomBytes} from 'node:crypto'
import {isolatedSandboxBootstrap} from './isolated-billing-bootstrap.js'
import {verifyRecoveryContextDatabase} from './verify-fiscal-recovery-context-database.js'
const enabled=process.env.QVESTA_TEST_RECOVERY_CONTEXT==='1'
const releaseMigrations=[
 '20261006010000_participant_profile_identity.sql',
 '20261006020000_record_account_activity.sql',
 '20261007030000_subscription_refund_received_at.sql',
]
function migrationPlan(files){
 const sorted=[...files].sort()
 expect(new Set(sorted.map(f=>f.slice(0,14))).size,'unique migration versions').toBe(sorted.length)
 const base=sorted.filter(f=>f.slice(0,14)<='20260914210000')
 const historical=sorted.filter(f=>f.slice(0,14)>'20260914210000'&&f<releaseMigrations[0])
 const release=sorted.filter(f=>f>=releaseMigrations[0])
 expect(base).toHaveLength(99)
 expect(historical).toHaveLength(225)
 expect(release,'exact reviewed release migrations').toEqual(releaseMigrations)
 expect([...base,...historical,...release]).toEqual(sorted)
 return {base,later:[...historical,...release]}
}

test('migration plan retains the historical boundary and rejects missing, extra or duplicate release versions',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql'))
 const plan=migrationPlan(files)
 expect(plan.later).toHaveLength(228)
 for(const file of releaseMigrations)expect(()=>migrationPlan(files.filter(f=>f!==file))).toThrow()
 expect(()=>migrationPlan([...files,'20261006030000_unreviewed.sql'])).toThrow()
 expect(()=>migrationPlan([...files,'20261006010000_duplicate.sql'])).toThrow()
 expect(()=>migrationPlan(files.filter(f=>f!==plan.later[0]))).toThrow()
})
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true,timeout:60000});if(r.status!==0)throw Error(r.stderr||'Docker failed');return r.stdout}
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
test.skipIf(!enabled)('R-only isolated full-chain database validation',async()=>{
 const name='qvesta-release-test-'+randomUUID().replaceAll('-','');let databaseId,authId
 const ownedIds=[]
 const failures=[]
 const create=args=>{
  const id=docker(['create','--pull','never','--label','qvesta.test.owner='+name,...args]).trim()
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Docker did not return a full container ID')
  ownedIds.push(id);console.log('OWNED_CREATE '+id+' owner='+name);return id
 }
  const inspect=(id,network,environment={})=>{
  const info=JSON.parse(docker(['inspect',id]))[0]
  const image=JSON.parse(docker(['image','inspect',info.Image]))[0].Config
  assertIsolation(info,{id,owner:name,network,image,environment})
 }
 const removeOwned=id=>{
  const info=JSON.parse(docker(['inspect',id]))[0]
  if(info.Id!==id||info.Config.Labels?.['qvesta.test.owner']!==name)throw Error('Cleanup ownership mismatch')
  docker(['rm','-f','-v',id]); if(docker(['ps','-aq','--no-trunc','--filter','id='+id]).trim())throw Error('Container remains after cleanup');console.log('OWNED_REMOVED '+id)
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
  const {base,later}=migrationPlan(files)
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
  sql("insert into auth.users(id,email) values(md5('production-baseline-fixture')::uuid,'baseline@example.test');")
  const snapshot=()=>sql("select md5(row_to_json(o)::text) from public.organizations o where personal_owner_id=md5('production-baseline-fixture')::uuid").trim()
  const before=snapshot()
  expect(before).toMatch(/^[a-f0-9]{32}$/)
  const applied=[...base]
  for(const file of later){
   if(file===releaseMigrations[0]){
    // Use real pinned Storage migrations, after the historical public-catalog
    // fingerprint has been checked. Share only this network-none DB namespace.
    const storageEnvironment={
     DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',
     AUTH_JWT_SECRET:randomBytes(48).toString('hex'),STORAGE_BACKEND:'file',
     FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:name,REGION:'local',
     FILE_SIZE_LIMIT:'1048576',DB_INSTALL_ROLES:'true',DB_MIGRATIONS_STRATEGY:'on_start',
     LOG_LEVEL:'fatal',S3_PROTOCOL_ENABLED:'false',
    }
    let storageId
    try{storageId=create(['--name',name+'-storage','--network','container:'+databaseId,
     '--tmpfs','/var/lib/storage:mode=1777',
     ...Object.entries(storageEnvironment).flatMap(([key,value])=>['-e',key+'='+value]),
     'supabase/storage-api:v1.70.3'])}catch{throw Error('Isolated Storage container creation failed')}
    inspect(storageId,'container:'+databaseId,storageEnvironment)
    inspect(databaseId,'none')
    docker(['start',storageId])
    let storageReady=false
    for(let i=0;i<80;i++){
     try{
      docker(['exec',storageId,'node','-e',"fetch('http://127.0.0.1:5000/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])
      storageReady=true;break
     }catch{await new Promise(r=>setTimeout(r,250))}
    }
    if(!storageReady)throw Error('Isolated Storage startup failed; diagnostics suppressed')
    expect(sql("select to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null").trim()).toBe('t')
    inspect(storageId,'container:'+databaseId,storageEnvironment)
   }
   try{sql(readFileSync(new URL(file,dir),'utf8'))}catch(error){throw Error('Migration '+file+' failed: '+error.message)}
   applied.push(file)
  }
  expect(applied,'every repository migration applied in order').toEqual(files)
  expect(sql("select public from storage.buckets where id='participant-avatars'").trim()).toBe('f')
  expect(sql("select relrowsecurity from pg_class where oid='public.account_activity'::regclass").trim()).toBe('t')
  expect(snapshot()).toBe(before)
  expect(sql("select s.status from public.organization_subscriptions s join public.organizations o on o.id=s.organization_id where o.personal_owner_id=md5('production-baseline-fixture')::uuid").trim()).toBe('transition')
  expect(sql('select count(*) from cron.job where active').trim()).toBe('0')
  expect(sql('select count(*) from public.billing_sandbox_orders').trim()).toBe('0')
  expect(sql('select count(*) from public.platform_access_assignments').trim()).toBe('0')

  sql(readFileSync(new URL('../supabase/release-migrations/20261003000000_adopt_billing_environment_guard.sql',import.meta.url),'utf8'))
  sql(isolatedSandboxBootstrap(name))
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
  await verifyRecoveryContextDatabase({sql,databaseId})
 }catch(error){failures.push(error)}finally{
  for(const id of ownedIds.reverse()){try{removeOwned(id)}catch{failures.push(Error('Own container cleanup failed: '+id))}}
 }
 if(failures.length)throw new AggregateError(failures,'R-only database validation or cleanup failed')
},300000)
