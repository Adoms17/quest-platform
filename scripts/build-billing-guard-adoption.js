import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {verifyProductionCandidate} from './verify-production-candidate-manifest.js'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n','\n')
export function guardCatalogSql() {
 const source=read('scripts/production-sandbox-guard.candidate.sql')
 const baseline=JSON.parse(source.split('$hashes$')[1])
 const names=[...Object.keys(baseline),
  'platform_private.require_sandbox_environment()',
  'platform_private.require_sandbox_projection()',
  'platform_private.guard_sandbox_period_confirmation()',
  'platform_private.check_initial_billing_environment()',
  'platform_private.protect_billing_environment_identity()']
 const signatures=names.map(s=>"'"+s+"'").join(',')
 return `with targets as (select unnest(array[${signatures}]) as signature),
 funcs as (
 select t.signature,replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)) as definition,
  pg_get_userbyid(p.proowner) as owner,
  coalesce((select jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee),'[]'::jsonb) as acl
 from targets t left join pg_proc p on p.oid=to_regprocedure(t.signature)
 ),
 relation as (
 select c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner,
  coalesce((select jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
   from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee),'[]'::jsonb) as acl
 from pg_class c where c.oid=to_regclass('platform_private.billing_runtime_environment')
 ),
 columns as (
 select a.attname,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid) as default_expression,a.attacl::text
 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid=to_regclass('platform_private.billing_runtime_environment') and a.attnum>0 and not a.attisdropped
 ),
 constraints as (
 select conname,contype,convalidated,pg_get_constraintdef(oid) as definition
 from pg_constraint where conrelid=to_regclass('platform_private.billing_runtime_environment')
 ),
 triggers as (
 select n.nspname||'.'||c.relname as relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and (t.tgrelid=to_regclass('platform_private.billing_runtime_environment')
 or (t.tgrelid='public.billing_period_confirmations'::regclass and t.tgname='sandbox_period_confirmation_environment'))
 ),
 policies as (
 select polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid) as qual,pg_get_expr(polwithcheck,polrelid) as check_expr
 from pg_policy where polrelid=to_regclass('platform_private.billing_runtime_environment')
 )
 select jsonb_build_object(
 'functions',(select jsonb_agg(to_jsonb(f) order by signature) from funcs f),
 'relation',(select to_jsonb(r) from relation r),
 'columns',(select jsonb_agg(to_jsonb(a) order by attname) from columns a),
 'constraints',(select jsonb_agg(to_jsonb(c) order by conname) from constraints c),
 'triggers',(select jsonb_agg(to_jsonb(t) order by relation,tgname) from triggers t),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by polname),'[]'::jsonb) from policies p)
 ) as catalog`
}
export function buildGuardAdoption(expected) {
 verifyProductionCandidate()
 if(!expected || expected.functions?.length!==41 || !expected.relation || expected.triggers?.length!==4)
  throw Error('Complete isolated guard catalog required')
 const quote=s=>"'"+s.replaceAll("'","''")+"'"
 const candidates=['scripts/production-sandbox-guard.candidate.sql','scripts/production-environment-pin.candidate.sql']
 const payload=candidates.map(path=>read(path).replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')).join('\n')
 const catalog=guardCatalogSql()
 return `-- Reviewed adoption candidate; NOT in automatic migration discovery.
-- Requires quiescent workers, independently verified target and reviewed release.
-- No environment provisioning, flags, provider calls or migration-history writes.
-- Expected catalog SHA256: ${createHash('sha256').update(JSON.stringify(expected)).digest('hex')}
begin;
set local search_path=pg_catalog;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(151,1);
do $adopt$
declare actual jsonb; expected constant jsonb := ${quote(JSON.stringify(expected))}::jsonb;
begin
 if to_regclass('platform_private.billing_runtime_environment') is null then
  -- Reject partial installation instead of silently repairing it.
  if to_regprocedure('platform_private.require_sandbox_environment()') is not null
   or to_regprocedure('platform_private.require_sandbox_projection()') is not null
   or to_regprocedure('platform_private.guard_sandbox_period_confirmation()') is not null
   or to_regprocedure('platform_private.check_initial_billing_environment()') is not null
   or to_regprocedure('platform_private.protect_billing_environment_identity()') is not null then
   raise exception 'billing guard partial installation';
  end if;
  execute ${quote(payload)};
 else
  lock table platform_private.billing_runtime_environment in access exclusive mode;
 end if;
 select catalog into actual from (${catalog}) snapshot;
 if actual is distinct from expected then
  raise exception 'billing guard catalog mismatch';
 end if;
end; $adopt$;
commit;
`
}
