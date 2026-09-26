// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
function docker(args,input) {
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:60000})
 if(r.status!==0) throw new Error(r.stderr||'Docker failed')
 return r.stdout
}
test.skipIf(process.env.QVESTA_TEST_PURCHASE_DOCUMENTS!=='1')('document registry RLS and immutability',async()=>{
 const name='qvesta-document-test-'+randomUUID().replaceAll('-','');let created=false
 try {
  docker(['run','-d','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/test-pg; chown postgres:postgres /tmp/test-pg; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg']);created=true
  let ready=false
  for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}
  if(!ready) throw new Error('Postgres not ready')
  const sql=s=>docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],s)
  sql('create role anon; create role authenticated; create role service_role; create extension pgtap;')
  sql(readFileSync(new URL('../supabase/migrations/20260926010000_purchase_document_versions.sql',import.meta.url),'utf8'))
  // Minimal synthetic role fixtures; use the actual owner and MFA guards from migrations.
  sql("create schema auth; create schema platform_private; create function auth.jwt() returns jsonb language sql as 'select current_setting(''request.jwt.claims'',true)::jsonb'; create function auth.uid() returns uuid language sql as 'select (auth.jwt()->>''sub'')::uuid'; create table public.platform_access_assignments(user_id uuid,role_key text,scope_kind text,revoked_at timestamptz,valid_from timestamptz,expires_at timestamptz);")
  const guards=readFileSync(new URL('../supabase/migrations/20260918040000_confirm_platform_commands.sql',import.meta.url),'utf8')
  sql(guards.slice(guards.indexOf('create function platform_private.require_recent_mfa'),guards.indexOf('alter table public.platform_audit_events')))
  sql(readFileSync(new URL('../supabase/migrations/20260926011000_manage_purchase_documents.sql',import.meta.url),'utf8'))
  sql(readFileSync(new URL('../supabase/migrations/20260926012000_purchase_document_audit.sql',import.meta.url),'utf8'))
  sql(readFileSync(new URL('../supabase/migrations/20260926013000_read_purchase_documents.sql',import.meta.url),'utf8'))
  // Minimal checkout fixture; full creation/payment integration is tested separately when wired.
  sql("create table public.billing_discount_checkouts(id uuid primary key,actor_id uuid,organization_id uuid); create function public.has_organization_permission(uuid,text) returns boolean language sql as 'select $1::text=current_setting(''test.workspace'',true)';")
  sql(readFileSync(new URL('../supabase/migrations/20260926014000_record_checkout_documents.sql',import.meta.url),'utf8'))
  const acceptance=sql(readFileSync(new URL('../supabase/tests/database/checkout_document_acceptance.test.sql',import.meta.url),'utf8'))
  expect(acceptance).not.toMatch(/not ok|Looks like/)
  const reads=sql(readFileSync(new URL('../supabase/tests/database/purchase_document_read.test.sql',import.meta.url),'utf8'))
  expect(reads).not.toMatch(/not ok|Looks like/)
  const audit=sql(readFileSync(new URL('../supabase/tests/database/purchase_document_audit.test.sql',import.meta.url),'utf8'))
  expect(audit).not.toMatch(/not ok|Looks like/)
  const management=sql(readFileSync(new URL('../supabase/tests/database/purchase_document_management.test.sql',import.meta.url),'utf8'))
  expect(management).not.toMatch(/not ok|Looks like/)
  const out=sql(readFileSync(new URL('../supabase/tests/database/purchase_document_versions.test.sql',import.meta.url),'utf8'))
  expect(out).not.toMatch(/not ok|Looks like/)
  expect(out).toContain('1..12')
 } finally { if(created) docker(['rm','-f',name]) }
},90000)
