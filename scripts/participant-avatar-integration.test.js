// @vitest-environment node
// Disposable real PostgreSQL/Auth-schema/Storage harness. No shared stack or ports.
import {test,expect} from 'vitest'
import {spawn,spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {createHmac,randomBytes,randomUUID} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {validateAvatarPng} from '../supabase/functions/_shared/participantAvatarPng.js'
const enabled=process.env.QVESTA_TEST_PARTICIPANT_AVATAR==='1'
const context=['--context','desktop-linux']
function docker(args,input){const r=spawnSync('docker',[...context,...args],{input,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true,timeout:180000});if(r.status!==0)throw Error('Disposable Docker command failed: '+args[0]+' '+(args[0]==='exec'?r.stderr:'details suppressed'));return r.stdout}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function png(){
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  const n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([n,body,c])}
 const header=Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0])
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))])
}
test.skipIf(!enabled)('PROFILE-01 real SQL/RLS, concurrent UUID reservation and Storage HTTP',async()=>{
 const owner='qvesta-profile-test-'+randomUUID().replaceAll('-',''),owned=[]
 const secret=randomBytes(48).toString('hex')
 const token=(role,sub,expired=false)=>{const now=Math.floor(Date.now()/1000),body=Buffer.from(JSON.stringify({role,sub,iss:'supabase',aud:'authenticated',iat:now-5,exp:expired?now-5:now+3600})).toString('base64url')
  const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+body
  return value+'.'+createHmac('sha256',secret).update(value).digest('base64url')}
 function inspect(id,network){
  const info=JSON.parse(docker(['inspect',id]))[0]
  expect(info.Id).toBe(id);expect(info.Config.Labels?.['qvesta.test.owner']).toBe(owner)
  expect(info.HostConfig.NetworkMode).toBe(network);expect(info.HostConfig.Privileged).toBe(false)
  expect(Object.keys(info.HostConfig.PortBindings||{})).toHaveLength(0)
  expect(info.HostConfig.Binds||[]).toHaveLength(0);expect(info.HostConfig.VolumesFrom||[]).toHaveLength(0)
  expect(info.HostConfig.RestartPolicy.Name).toBe('no')
  expect((info.Mounts||[]).every(m=>m.Type==='tmpfs'||m.Type==='volume'&&/^[a-f0-9]{64}$/.test(m.Name))).toBe(true)
 }
 function create(suffix,image,network,args=[],env={},command=[]){
  const id=docker(['create','--pull','never','--restart','no','--label','qvesta.test.owner='+owner,'--name',owner+suffix,'--network',network,
   ...Object.entries(env).flatMap(([key,value])=>['-e',key+'='+value]),...args,image,...command]).trim()
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid owned container ID');owned.push({id,network});inspect(id,network);return id
 }
 let db,storage
 try{
  // Same isolated initialization pattern as production-baseline-migrations.test.js.
  const id=docker(['create','--pull','never','--restart','no','--label','qvesta.test.owner='+owner,'--name',owner,'--network','none','--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c',
   'mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']).trim()
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid database ID');db=id;owned.push({id,network:'none'});inspect(db,'none');docker(['start',db])
  let ready=false;for(let i=0;i<100;i++){try{docker(['exec',db,'pg_isready','-U','postgres']);ready=true;break}catch{await pause(300)}}expect(ready).toBe(true)
  const sql=input=>docker(['exec','-i',db,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input).trim()
  sql(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
   create role supabase_admin superuser; create role authenticator noinherit login; create role dashboard_user; create role supabase_read_only_user;
   grant anon,authenticated,service_role to authenticator with inherit false;
   revoke all on schema public from public; grant usage on schema public to anon,authenticated;
   grant usage,create on schema public to service_role; create schema auth; alter role postgres set search_path=auth,public;`)
  const auth=create('-auth','supabase/gotrue:v2.196.0','container:'+db,['--entrypoint','auth'],{
   GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',
   API_EXTERNAL_URL:'http://127.0.0.1',GOTRUE_SITE_URL:'http://127.0.0.1',GOTRUE_JWT_SECRET:secret,GOTRUE_LOG_LEVEL:'fatal'},['migrate'])
  // Fresh Auth schema only; no shared database dump and no account credentials.
  docker(['start',auth]);await pause(1500)
  let authReady=false;for(let i=0;i<50;i++){if(sql("select to_regprocedure('auth.uid()') is not null")==='t'){authReady=true;break}await pause(300)}expect(authReady).toBe(true)
  sql(`alter role postgres reset search_path; grant usage on schema auth to anon,authenticated,service_role;
   alter default privileges for role postgres in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
   alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`)
  const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()
  const identity=files.find(f=>f==='20261006010000_participant_profile_identity.sql');expect(identity).toBeTruthy()
  const prior=files.filter(f=>f<identity);expect(prior).toHaveLength(324)
  sql(prior.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  console.info('PROFILE-01: 324 historical migrations applied in owned network-none database')
  storage=create('-storage','supabase/storage-api:v1.70.3','container:'+db,['--tmpfs','/var/lib/storage:mode=1777'],{
   DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',AUTH_JWT_SECRET:secret,
   STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:owner,REGION:'local',
   FILE_SIZE_LIMIT:'1048576',DB_INSTALL_ROLES:'true',DB_MIGRATIONS_STRATEGY:'on_start',LOG_LEVEL:'fatal',S3_PROTOCOL_ENABLED:'false'})
  docker(['start',storage])
  const requestScript=`let text='';for await(const chunk of process.stdin)text+=chunk;const x=JSON.parse(text);try{
   const r=await fetch('http://127.0.0.1:5000'+x.path,{method:x.method,headers:x.headers,body:x.body?Buffer.from(x.body,'base64'):undefined,signal:AbortSignal.timeout(10000)});
   const bytes=Buffer.from(await r.arrayBuffer());let body;try{body=JSON.parse(bytes.toString())}catch{body=null}console.log(JSON.stringify({status:r.status,body,length:bytes.length}));
   }catch{console.log(JSON.stringify({status:0}))}`
  const http=(method,path,jwt,body,contentType)=>JSON.parse(docker(['exec','-i',storage,'node','--input-type=module','-e',requestScript],JSON.stringify({method,path,
   headers:{...(jwt?{Authorization:'Bearer '+jwt}:{}),...(contentType?{'Content-Type':contentType}:{})},body:body?Buffer.from(body).toString('base64'):undefined})))
  const service=token('service_role')
  let storageReady=false;for(let i=0;i<40;i++){try{if(http('GET','/bucket',service).status===200){storageReady=true;break}}catch{/* booting */}await pause(300)}
  expect(storageReady,'owned Storage server booted').toBe(true)
  sql(readFileSync(new URL(identity,dir),'utf8'))
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
  for(const suite of ['participant_identity','participant_avatar_cleanup_race','participant_profile_card','group_member_catalog','group_exit_actions']){
   const out=sql('set search_path=public,extensions;\n'+readFileSync(new URL('../supabase/tests/database/'+suite+'.test.sql',import.meta.url),'utf8'))
   expect(out,suite).not.toMatch(/not ok|Looks like/);expect(out,suite).toMatch(/1\.\.\d+/)
   console.info('PROFILE-01 pgTAP PASS: '+suite)
  }
  const actor='99000000-0000-4000-8000-000000000001',reader='99000000-0000-4000-8000-000000000002',other='99000000-0000-4000-8000-000000000003'
  const profile='99000000-0000-4000-8000-000000000011',concurrent='99000000-0000-4000-8000-000000000012',old='99000000-0000-4000-8000-000000000021',fresh='99000000-0000-4000-8000-000000000022',race='99000000-0000-4000-8000-000000000023'
  sql(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}','avatar-owner@example.test','{"username":"HttpOwner"}'),('${reader}','avatar-reader@example.test','{"username":"HttpReader"}'),('${other}','avatar-other@example.test','{"username":"HttpOther"}');
   insert into public.participant_profiles(id,display_name,created_by_user_id) values('${profile}','HTTP avatar','${actor}'),('${concurrent}','Concurrent avatar','${actor}');
   insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values('${actor}','${profile}'),('${reader}','${profile}');`)
  const asActor=query=>sql(`set request.jwt.claim.sub='${actor}';set role authenticated;${query}`)
  const object=id=>`${profile}/${id}.png`,route=id=>'/object/participant-avatars/'+object(id)
  const bytes=png();await validateAvatarPng(bytes)
  asActor(`select public.begin_participant_avatar('${profile}','${old}',0)`)
  expect(http('POST',route(old),service,bytes,'image/png').status).toBe(200)
  const ownerJwt=token('authenticated',actor),readerJwt=token('authenticated',reader),otherJwt=token('authenticated',other)
  const denied=response=>{expect(response.status).toBeGreaterThanOrEqual(400);expect(response.status).toBeLessThan(500)}
  denied(http('GET',route(old),ownerJwt))
  sql(`select public.confirm_participant_avatar_upload('${old}','${actor}')`)
  asActor(`select public.save_participant_identity('${profile}',0,'Explorer','${old}')`)
  expect(http('GET',route(old),ownerJwt).status).toBe(200);expect(http('GET',route(old),readerJwt).status).toBe(200)
  denied(http('GET',route(old),otherJwt));denied(http('GET',route(old),token('anon')));denied(http('GET',route(old),token('authenticated',actor,true)))
  denied(http('GET','/object/public/participant-avatars/'+object(old)))
  denied(http('POST',route(fresh),ownerJwt,bytes,'image/png'))
  denied(http('PUT',route(old),ownerJwt,bytes,'image/png'))
  http('DELETE','/object/participant-avatars',ownerJwt,JSON.stringify({prefixes:[object(old)]}),'application/json')
  expect(http('GET',route(old),ownerJwt).status).toBe(200)
  sql(`update public.participant_supervisions set status='revoked' where supervisor_user_id='${reader}'`)
  denied(http('GET',route(old),readerJwt))
  asActor(`select public.save_participant_identity('${profile}',1,'Explorer',null,true)`)
  const claimA=JSON.parse(asActor(`select public.claim_participant_avatar_cleanup('${profile}')`)),claimB=JSON.parse(asActor(`select public.claim_participant_avatar_cleanup('${profile}')`));expect(claimA).toEqual(claimB)
  const remove=items=>http('DELETE','/object/participant-avatars',service,JSON.stringify({prefixes:items.map(x=>x.path)}),'application/json')
  expect(remove(claimA).status).toBe(200);sql(`select public.finish_participant_avatar_cleanup(array['${old}'::uuid])`)
  expect(()=>asActor(`select public.begin_participant_avatar('${profile}','${old}',2)`)).toThrow()
  asActor(`select public.begin_participant_avatar('${profile}','${fresh}',2)`)
  expect(http('POST',route(fresh),service,bytes,'image/png').status).toBe(200)
  sql(`select public.confirm_participant_avatar_upload('${fresh}','${actor}')`);asActor(`select public.save_participant_identity('${profile}',2,'Explorer','${fresh}')`)
  expect(remove(claimB).status).toBe(200);sql(`select public.finish_participant_avatar_cleanup(array['${old}'::uuid])`)
  expect(http('GET',route(fresh),ownerJwt).status).toBe(200);denied(http('GET',route(old),ownerJwt))
  console.info('PROFILE-01 real Storage HTTP PASS: staged/private/public/ownership/write denial/revocation/late cleanup')
  // Two real PostgreSQL sessions: B waits on A's row lock, then PK rejects reuse.
  const connect=()=>{const child=spawn('docker',[...context,'exec','-i',db,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});let stdout='',stderr=''
   child.stdout.on('data',x=>{stdout+=x});child.stderr.on('data',x=>{stderr+=x})
   const done=new Promise(resolve=>child.on('close',code=>resolve({code,stdout,stderr})));return {child,done,output:()=>stdout}}
  const a=connect(),b=connect()
  try{
   a.child.stdin.write(`begin;set request.jwt.claim.sub='${actor}';set role authenticated;select public.begin_participant_avatar('${concurrent}','${race}',0);select 'reserved';\n`)
   for(let i=0;i<100&&!a.output().includes('reserved');i++)await pause(50);expect(a.output()).toContain('reserved')
   b.child.stdin.end(`set application_name='profile_avatar_waiter';set request.jwt.claim.sub='${actor}';set role authenticated;select public.begin_participant_avatar('${concurrent}','${race}',0);`)
   let blocked=false;for(let i=0;i<30;i++){if(sql("select count(*) from pg_stat_activity where application_name='profile_avatar_waiter' and wait_event_type='Lock'")==='1'){blocked=true;break}await pause(50)}expect(blocked).toBe(true)
   a.child.stdin.end('commit;');expect((await a.done).code).toBe(0)
   const result=await b.done;expect(result.code).not.toBe(0);expect(result.stderr).toContain('participant_avatar_ids_pkey')
   expect(sql(`select count(*) from platform_private.participant_avatar_ids where id='${race}'`)).toBe('1')
   expect(sql(`select count(*) from platform_private.participant_avatar_uploads where id='${race}'`)).toBe('1')
  }finally{a.child.stdin.end();b.child.stdin.end()}
  console.info('PROFILE-01 real two-session duplicate reservation PASS')
 }finally{
  for(const entry of owned.reverse()){inspect(entry.id,entry.network);docker(['rm','-f','-v',entry.id])}
  console.info('PROFILE-01: removed only owned disposable container IDs')
 }
},600000)
