// @vitest-environment node
import {test,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {randomUUID,randomBytes} from 'node:crypto'
const enabled=process.env.QVESTA_TEST_REFUND_RECEIVED_AT==='1'
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('Disposable refund command failed: '+(args[0]==='exec'?r.stderr:'diagnostics suppressed'));return r.stdout.trim()}
test.skipIf(!enabled)('receipt migration preserves history, SQL policy and closed ACLs in network-none disposable DB',async()=>{
 const owner='qvesta-refund-receipt-'+randomUUID().replaceAll('-','');const ids=[]
 const create=args=>{const id=docker(['create','--pull','never','--label','qvesta.test.owner='+owner,...args]);if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid container id');ids.push(id);return id}
 const check=(id,network)=>{const i=JSON.parse(docker(['inspect',id]))[0];if(i.Id!==id||i.Config.Labels?.['qvesta.test.owner']!==owner||i.HostConfig.NetworkMode!==network||i.HostConfig.Privileged||i.HostConfig.Binds?.length||Object.values(i.NetworkSettings.Ports??{}).some(Boolean))throw Error('Disposable isolation mismatch')}
 try{
  const db=create(['--name',owner,'--network','none','--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres']);check(db,'none');docker(['start',db]);
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',db,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,250))}}if(!ready)throw Error('Disposable Postgres unavailable')
  const sql=input=>docker(['exec','-i',db,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],input)
  sql('create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create role supabase_admin superuser;create role authenticator;create role dashboard_user;create role supabase_read_only_user;create schema auth;alter role postgres set search_path=auth,public;')
  const auth=create(['--name',owner+'-auth','--network','container:'+db,'-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_DB_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable','-e','API_EXTERNAL_URL=http://127.0.0.1','-e','GOTRUE_SITE_URL=http://127.0.0.1','-e','GOTRUE_LOG_LEVEL=fatal','-e','GOTRUE_JWT_SECRET='+randomBytes(48).toString('hex'),'supabase/gotrue:v2.196.0','auth','migrate']);check(auth,'container:'+db);docker(['start','--attach',auth]);
  sql('alter role postgres reset search_path;grant usage on schema auth to anon,authenticated,service_role;')
  const dir=new URL('../supabase/migrations/',import.meta.url),candidate='20261007030000_subscription_refund_received_at.sql'
  const historical=readdirSync(dir).filter(f=>f.endsWith('.sql')&&f<'20261006010000').sort()
  for(const file of historical)sql(readFileSync(new URL(file,dir),'utf8'))
  sql('create extension if not exists pgtap with schema extensions;grant usage on schema extensions to anon,authenticated,service_role;')
  const original=readFileSync(new URL('../supabase/tests/database/subscription_refund_requests.test.sql',import.meta.url),'utf8')
  const fixture=original.slice(0,original.indexOf('select is(')).replace('select no_plan();','').replaceAll('subscription-refund','legacy-subscription-refund')+'commit;'
  sql(fixture)
  const legacyBefore=JSON.parse(sql("select to_jsonb(r) from public.subscription_refund_requests r"))
  sql(readFileSync(new URL(candidate,dir),'utf8'))
  const legacyAfter=JSON.parse(sql("select to_jsonb(r)-'received_at'-'receipt_source' from public.subscription_refund_requests r"));expect(legacyAfter).toEqual(legacyBefore)
  expect(sql('select received_at is null and receipt_source is null from public.subscription_refund_requests')).toBe('t')
  const suites=['subscription_refund_received_at','subscription_refund_preparation','subscription_refund_requests','subscription_refund_boundary','subscription_refund_preflight']
  for(const suite of suites){const output=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/'+suite+'.test.sql',import.meta.url),'utf8'));expect(output,suite).not.toMatch(/^not ok /m);expect(output,suite).toMatch(/^1\.\.\d+/m);console.log(suite+': '+output.match(/^1\.\.\d+/m)?.[0])}
  check(db,'none')
 }finally{cleanupOwnedContainers()}
 function cleanupOwnedContainers(){for(const id of ids.reverse()){const i=JSON.parse(docker(['inspect',id]))[0];if(i.Id!==id||i.Config.Labels?.['qvesta.test.owner']!==owner)throw Error('Cleanup ownership mismatch');docker(['rm','-f','-v',id])}}
},240000)
