// @vitest-environment node
import { test,expect } from 'vitest'
import { spawnSync } from 'node:child_process'
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

  sql(files.map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n'))
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')

 const tariffPrices=sql('set search_path=public,extensions;'+readFileSync(new URL('../supabase/tests/database/tariff_monthly_prices.test.sql',import.meta.url),'utf8'))
 expect(tariffPrices).not.toMatch(/not ok|Looks like/)
 const suite=readFileSync(new URL('../supabase/tests/database/checkout_documents_atomic.test.sql',import.meta.url),'utf8')
 const out=sql('set search_path=public,extensions;'+suite)
 expect(out).not.toMatch(/not ok|Looks like/)
 expect(out).toMatch(/1\.\.\d+/)
 const paid=suite.replace('10000,2,1','5000,2,1').replace("'0','100 percent discount supported'", "'6172','paid checkout with discount supported'")
 const orderChecks=readFileSync(new URL('../supabase/tests/database/platform_order_documents.test.sql',import.meta.url),'utf8')
 const paidOut=sql('set search_path=public,extensions;'+paid.replace('select * from finish();rollback;', () => orderChecks+'\nselect * from finish();rollback;'))
 expect(paidOut).not.toMatch(/not ok|Looks like/)

 } finally {if(created)docker(['rm','-f',name])}
},180000)
