// @vitest-environment node
// Opt-in real browser -> Kong -> Edge/Auth/PostgREST/Storage; no API mocks.
// Requires npm-installed exact 2.112.3 in the ignored profile-full-e2e/deps fixture.
import {test,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {randomBytes,randomUUID,createHmac,createHash} from 'node:crypto'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {chromium,expect as browserExpect} from '@playwright/test'
import {finishOwnedTest,ownedCleanupStep} from './participant-avatar-cleanup.js'

const enabled=process.env.QVESTA_TEST_PARTICIPANT_FULL_E2E==='1'
const pause=ms=>new Promise(r=>setTimeout(r,ms))
function docker(args,input){const r=spawnSync('docker',['--context','desktop-linux',...args],{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});if(r.status!==0)throw Error('Owned Docker '+args[0]+' failed (arguments/output suppressed)');return (args[0]==='logs'?r.stdout+r.stderr:r.stdout).trim()}

test.skipIf(!enabled)('PROFILE-01 full local browser/Auth/Edge/Storage lifecycle',async()=>{
 const owner='qvesta-profile-full-'+randomUUID().replaceAll('-',''),owned=[]
 const cache=resolve('node_modules/.cache/profile-full-e2e'),deps=join(cache,'deps')
 const lock=JSON.parse(readFileSync(join(deps,'package-lock.json'),'utf8'))
 expect(lock.packages['node_modules/@supabase/supabase-js'].version).toBe('2.112.3')
 for(const [key,p] of Object.entries(lock.packages)){if(key){expect(p.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);expect(p.integrity).toMatch(/^sha512-/)}}
 const receipt={owner,started:new Date().toISOString(),dependencyLockSha256:createHash('sha256').update(readFileSync(join(deps,'package-lock.json'))).digest('hex'),steps:[],containers:[],cleanup:false}
 const step=name=>{receipt.steps.push(name);console.info('FULL E2E PASS: '+name)}
 const secret=randomBytes(48).toString('hex')
 const token=role=>{const now=Math.floor(Date.now()/1000);const value=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,iss:'supabase',iat:now-1,exp:now+3600})).toString('base64url');return value+'.'+createHmac('sha256',secret).update(value).digest('base64url')}
 const anon=token('anon'),service=token('service_role'),password=randomBytes(24).toString('hex')
 let network,db,browser,vite,primaryError
 function inspect(id,mode){
  const v=JSON.parse(docker(['inspect','--format','{"Id":{{json .Id}},"Owner":{{json (index .Config.Labels "qvesta.test.owner")}},"Network":{{json .HostConfig.NetworkMode}},"Mounts":{{json .Mounts}},"Binds":{{json .HostConfig.Binds}},"Privileged":{{json .HostConfig.Privileged}},"Ports":{{json .HostConfig.PortBindings}}}',id]))
  expect(v.Id).toBe(id);expect(v.Owner).toBe(owner);expect(v.Network).toBe(mode);expect(v.Privileged).toBe(false);expect(v.Binds||[]).toHaveLength(0)
  expect(v.Mounts.every(x=>x.Type==='tmpfs')).toBe(true)
  for(const values of Object.values(v.Ports||{}))for(const value of values||[])expect(value.HostIp).toBe('127.0.0.1')
 }
 function create(suffix,image,mode,args=[],env={},command=[]){
  const id=docker(['create','--pull','never','--restart','no','--name',owner+suffix,'--label','qvesta.test.owner='+owner,'--network',mode,...args,...Object.entries(env).flatMap(([k,v])=>['-e',k+'='+v]),image,...command])
  expect(id).toMatch(/^[a-f0-9]{64}$/);owned.push({id,mode});receipt.containers.push({id,suffix});inspect(id,mode);return id
 }
 const start=id=>docker(['start',id])
 async function until(check,label){for(let i=0;i<60;i++){try{if(await check())return}catch{/* startup */}await pause(300)}throw Error(label+' startup failed')}
 try{
  network=docker(['network','create','--internal','--label','qvesta.test.owner='+owner,owner])
  const net=JSON.parse(docker(['network','inspect',network]))[0];expect(net.Internal).toBe(true);expect(net.Labels['qvesta.test.owner']).toBe(owner)
  db=create('','supabase/postgres:17.6.1.165',owner,['--tmpfs','/tmp','--entrypoint','sh'],{},['-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres'])
  start(db);await until(()=>docker(['exec',db,'pg_isready','-U','postgres']).includes('accepting'),'DB')
  const sql=input=>docker(['exec','-i',db,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input)
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create role supabase_admin superuser;create role authenticator noinherit login;create role dashboard_user;create role supabase_read_only_user;grant anon,authenticated,service_role to authenticator with inherit false;revoke all on schema public from public;grant usage on schema public to anon,authenticated;grant usage,create on schema public to service_role;create schema auth;alter role postgres set search_path=auth,public;`)
  const mode='container:'+db
  const auth=create('-auth','supabase/gotrue:v2.196.0',mode,[],{GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable&search_path=auth',GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:8000/auth/v1',GOTRUE_SITE_URL:'http://127.0.0.1:4173',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_ISSUER:'supabase',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_LOG_LEVEL:'error'})
  start(auth);await until(()=>sql("select to_regprocedure('auth.uid()') is not null")==='t','Auth schema')
  sql('alter role postgres reset search_path;grant usage on schema auth to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;')
  const migrations=resolve('supabase/migrations'),identity='20261006010000_participant_profile_identity.sql'
  const prior=readdirSync(migrations).filter(x=>x.endsWith('.sql')&&x<identity).sort();expect(prior).toHaveLength(324)
  sql(prior.map(x=>readFileSync(join(migrations,x),'utf8')).join('\n'))
  const storage=create('-storage','supabase/storage-api:v1.70.3',mode,['--tmpfs','/var/lib/storage:mode=1777'],{DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable',AUTH_JWT_SECRET:secret,STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:owner,REGION:'local',FILE_SIZE_LIMIT:'1048576',DB_INSTALL_ROLES:'true',DB_MIGRATIONS_STRATEGY:'on_start',LOG_LEVEL:'fatal',S3_PROTOCOL_ENABLED:'false'})
  start(storage);await until(()=>sql("select to_regclass('storage.objects') is not null")==='t','Storage schema')
  sql(readFileSync(join(migrations,identity),'utf8'))
  const rest=create('-rest','postgrest/postgrest:v16.1',mode,[],{PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/postgres',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_PORT:'3000',PGRST_LOG_LEVEL:'crit'});start(rest)
  mkdirSync(join(deps,'participant-avatar'),{recursive:true});mkdirSync(join(deps,'_shared'),{recursive:true})
  for(const name of ['participant-avatar/index.ts','_shared/participantAvatarEndpoint.js','_shared/participantAvatarPng.js'])copyFileSync(join('supabase/functions',name),join(deps,name))
  writeFileSync(join(deps,'deno.json'),JSON.stringify({nodeModulesDir:'manual'}))
  const edge=create('-edge','supabase/edge-runtime:v1.74.3',mode,['-w','/tmp/avatar-fixture'],{SUPABASE_URL:'http://127.0.0.1:8000',SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service},['start','--main-service','/tmp/avatar-fixture/participant-avatar'])
  docker(['cp',deps+'/.',edge+':/tmp/avatar-fixture']);start(edge)
  // Kong performs real JWT verification for functions. All upstreams are own services.
  const kongConfig={_format_version:'2.1',consumers:[{username:'local-jwt',jwt_secrets:[{key:'supabase',secret,algorithm:'HS256'}]}],services:[
   {name:'auth',url:'http://127.0.0.1:9999',routes:[{name:'auth',paths:['/auth/v1/'],strip_path:true}]},
   {name:'rest',url:'http://127.0.0.1:3000',routes:[{name:'rest',paths:['/rest/v1/'],strip_path:true}]},
   {name:'storage',url:'http://127.0.0.1:5000',routes:[{name:'storage',paths:['/storage/v1/'],strip_path:true}]},
   {name:'edge',url:'http://127.0.0.1:9000',routes:[{name:'edge',paths:['/functions/v1/participant-avatar'],strip_path:true}],plugins:[{name:'jwt',config:{key_claim_name:'iss',claims_to_verify:['exp'],run_on_preflight:false}}]},
  ],plugins:[{name:'cors',config:{origins:['http://127.0.0.1:4173'],methods:['GET','POST','PUT','DELETE','OPTIONS','PATCH'],headers:['authorization','apikey','content-type','x-client-info','x-supabase-api-version','x-qvesta-device-id','x-profile-id','x-upload-id','x-profile-revision'],credentials:true}}]}
  // Credentials stay only inside the disposable gateway, written via stdin.
  const kong=create('-gateway','kong:2.8.1',mode,[],{KONG_DATABASE:'off',KONG_DECLARATIVE_CONFIG:'/tmp/kong.json',KONG_PROXY_LISTEN:'0.0.0.0:8000',KONG_ADMIN_LISTEN:'off',KONG_PROXY_ACCESS_LOG:'/dev/null',KONG_PROXY_ERROR_LOG:'/dev/null'},['kong','docker-start'])
  // docker cp streams tar from stdin, avoiding host persistence of synthetic secrets.
  const body=Buffer.from(JSON.stringify(kongConfig)),header=Buffer.alloc(512)
  header.write('kong.json');header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write('00',263);header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148)
  docker(['cp','-',kong+':/tmp'],Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512+1024)]));start(kong)
  // An internal Docker network deliberately has no host-published port. This byte
  // transport forwards HTTP to the real Kong listener via docker exec; it does not
  // implement or mock any API, authorization, SQL, Storage or Edge response.
  const relayScript=`let input='';for await(const c of process.stdin)input+=c;const x=JSON.parse(input);try{const r=await fetch('http://127.0.0.1:8000'+x.path,{method:x.method,headers:x.headers,body:x.body?Buffer.from(x.body,'base64'):undefined,signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer()).toString('base64')}))}catch{console.log(JSON.stringify({status:503,headers:{},body:''}))}`
  const relay=(path,method='GET',headers={},body)=>{const r=JSON.parse(docker(['exec','-i',storage,'node','--input-type=module','-e',relayScript],JSON.stringify({path,method,headers,body:body?Buffer.from(body).toString('base64'):undefined})));return new Response(r.body?Buffer.from(r.body,'base64'):null,{status:r.status,headers:r.headers})}
  const api='http://127.0.0.1:4173/local-supabase'
  try{await until(()=>relay('/auth/v1/health').ok,'gateway/Auth')}catch(error){const logs=docker(['logs','--tail','12',kong]).replaceAll(secret,'[synthetic]').replaceAll(anon,'[synthetic]').replaceAll(service,'[synthetic]');throw Error(error.message+' '+logs)}
  await until(()=>relay('/rest/v1/').ok,'PostgREST')
  const request=(path,body,jwt=service)=>relay(path,'POST',{'Content-Type':'application/json',Authorization:'Bearer '+jwt,apikey:anon},JSON.stringify(body))
  const userResponse=await request('/auth/v1/admin/users',{email:'avatar-full@example.test',password,email_confirm:true,user_metadata:{username:'AvatarFull'}})
  if(userResponse.status!==200){const logs=docker(['logs','--tail','20',auth]).split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.error?[String(row.error)]:[]}catch{return []}}).join('\n').replaceAll(secret,'[synthetic]').replaceAll(service,'[synthetic]').replaceAll(password,'[synthetic]');throw Error('Synthetic GoTrue create failed: '+logs)}
  expect(userResponse.status,'real GoTrue admin creates synthetic user').toBe(200)
  const user=await userResponse.json(),profile=randomUUID()
  sql(`insert into public.participant_profiles(id,display_name,created_by_user_id) values('${profile}','Full Browser Participant','${user.id}');insert into public.participant_supervisions(supervisor_user_id,participant_profile_id) values('${user.id}','${profile}');`)
  expect((await request('/functions/v1/participant-avatar',{},'invalid')).status).toBe(401)
  step('fresh isolated DB/Auth/Storage/PostgREST/Kong/Edge; gateway rejects invalid JWT')
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Editor from '/src/components/ParticipantIdentityEditor.jsx';import {supabase} from '/src/supabaseClient.js';window.client=supabase;const root=createRoot(document.getElementById('root'));let profileId;window.show=profile=>root.render(React.createElement(Editor,{profile,onSaved:()=>window.refresh(),onReload:()=>window.refresh()}));window.refresh=async(id=profileId)=>{profileId=id;const {data,error}=await supabase.rpc('get_participant_profile_card',{p_participant_profile_id:profileId});if(error)throw error;window.card=data;window.show(data)};window.ready=true;`
  vite=await createServer({configFile:false,envDir:false,root:process.cwd(),cacheDir:'node_modules/.cache/profile-full-e2e/vite',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(api),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(anon)},server:{host:'127.0.0.1',port:4173,strictPort:true},plugins:[{name:'full-e2e-fixture',resolveId:id=>id==='/full-fixture.js'?'\0full-fixture':null,load:id=>id==='\0full-fixture'?entry:null,configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(req.url.startsWith('/local-supabase/')){try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];delete headers['accept-encoding'];const response=relay(req.url.slice('/local-supabase'.length),req.method,headers,chunks.length?Buffer.concat(chunks):undefined);res.statusCode=response.status;for(const [k,v] of response.headers)if(!['content-length','content-encoding','transfer-encoding','connection'].includes(k))res.setHeader(k,v);res.end(Buffer.from(await response.arrayBuffer()))}catch{res.statusCode=502;res.end()}return}
   if(req.url!=='/full-e2e')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/full-e2e','<!doctype html><div id="root"></div><script type="module" src="/full-fixture.js"></script>'))})}},react()]})
  await vite.listen()
  browser=await chromium.launch({channel:'chrome',headless:true})
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{const url=route.request().url();return url.startsWith('http://127.0.0.1:4173/')||url.startsWith(api+'/')||url.startsWith('blob:')?route.continue():route.abort()})
  await page.goto('http://127.0.0.1:4173/full-e2e');await page.waitForFunction(()=>window.ready)
  const login=await page.evaluate(async password=>{const {data,error}=await window.client.auth.signInWithPassword({email:'avatar-full@example.test',password});return {ok:!!data.session,error:error?.message}},password)
  expect(login).toEqual({ok:true,error:undefined});await page.evaluate(id=>window.refresh(id),profile)
  await browserExpect(page.getByRole('form',{name:'Никнейм и аватар'})).toBeVisible();step('browser real Auth password login and profile RPC')
  await page.getByLabel('Никнейм (необязательно)').fill('FullExplorer')
  const input=page.getByLabel('Выбрать аватар'),save=page.getByRole('button',{name:'Сохранить никнейм и аватар'})
  let oldPath
  for(const type of ['image/png','image/jpeg']){
   const bytes=Buffer.from(await page.evaluate(async type=>{const c=document.createElement('canvas');c.width=300;c.height=200;c.getContext('2d').fillRect(0,0,300,200);const b=await new Promise(r=>c.toBlob(r,type));return Array.from(new Uint8Array(await b.arrayBuffer()))},type))
   await input.setInputFiles({name:type==='image/png'?'synthetic.png':'synthetic.jpg',mimeType:type,buffer:bytes});await browserExpect(page.getByAltText('Предпросмотр нового аватара')).toBeVisible();await save.click()
   await browserExpect(page.getByAltText('Аватар: Full Browser Participant')).toBeVisible()
   await expect.poll(()=>page.evaluate(()=>window.card.nickname)).toBe('FullExplorer')
   const path=await page.evaluate(()=>window.card.avatar_path);expect(path).toMatch(new RegExp('^'+profile+'/'))
   expect(sql(`select count(*) from storage.objects where bucket_id='participant-avatars' and name='${path}'`)).toBe('1')
   if(oldPath){expect(path).not.toBe(oldPath);await until(()=>sql(`select count(*) from storage.objects where bucket_id='participant-avatars' and name='${oldPath}'`)==='0','old avatar cleanup')}
   oldPath=path;step('browser '+type+' -> unchanged Edge -> real Storage -> identity RPC -> authenticated image')
  }
  await page.getByRole('button',{name:'Убрать аватар'}).click();await save.click()
  await expect.poll(()=>page.evaluate(()=>window.card.avatar_path),{timeout:15000}).toBe(null)
  await until(()=>sql(`select count(*) from storage.objects where bucket_id='participant-avatars' and name='${oldPath}'`)==='0','removed avatar cleanup')
  expect(sql(`select count(*) from platform_private.participant_avatar_uploads where profile_id='${profile}'`)).toBe('0')
  expect(sql('select count(*) from platform_private.participant_avatar_ids')).toBe('2')
  step('browser removal -> real Edge cleanup deletes objects/live metadata; two UUID anti-reuse IDs retained')
  expect(errors).toEqual([])
  await page.evaluate(async()=>{await window.client.auth.signOut();window.client.auth.stopAutoRefresh();await window.client.removeAllChannels()})
  receipt.pass=true
 }catch(error){primaryError=error}finally{
  const steps=[]
  if(browser)steps.push({name:'browser',run:()=>browser.close()})
  if(vite)steps.push({name:'vite',run:()=>vite.close()})
  for(const entry of [...owned].reverse())steps.push(ownedCleanupStep('container:'+entry.id,()=>inspect(entry.id,entry.mode),()=>docker(['rm','-f',entry.id])))
  if(network)steps.push(ownedCleanupStep('network:'+network,()=>{const n=JSON.parse(docker(['network','inspect',network]))[0];expect(n.Id).toBe(network);expect(n.Labels['qvesta.test.owner']).toBe(owner);expect(Object.keys(n.Containers||{})).toHaveLength(0)},()=>docker(['network','rm',network])))
  await finishOwnedTest({steps,receipt,primaryError,writeReceipt:value=>{mkdirSync(cache,{recursive:true});writeFileSync(join(cache,owner+'-receipt.json'),JSON.stringify(value,null,2))}})
 }
},240000)
