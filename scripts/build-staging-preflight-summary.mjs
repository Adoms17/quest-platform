import {readFileSync,writeFileSync} from 'node:fs'

const folder=new URL('../docs/qa/staging-owner-packet-20261007/',import.meta.url)
const original=readFileSync(new URL('01-preflight.sql',folder),'utf8')
const body=original.match(/do \$preflight\$ begin([\s\S]*?)end \$preflight\$;/)?.[1]
if(!body) throw Error('Missing original guard block')
const pattern=/if ([\s\S]*?) then\s+raise exception '([^']*)';\s+end if;/g
const guards=[...body.matchAll(pattern)]
if(guards.length!==11 || body.replace(pattern,'').trim()) throw Error('Original guard parsing changed; STOP')
const rows=guards.map((m,i)=>`('${i+1}: ${m[2]}',coalesce(not (${m[1]}),false))`)
const expected=[
  ['get_participant_profile_card','403b20df44581ddfacec5e458a5af86b4f27703e5bc567044e931affa6c37251'],
  ['search_participant_group_members','39196ff584afadb709ccad82a7b4a4219029538d9a200a1450f1ed4a283b5fcd'],
]
writeFileSync(new URL('01-summary.sql',folder),`-- STAGING jeugfyaqzfgdvfhdxfht only. Owner must verify Dashboard URL/header.
-- Single JSON result; every original 01 guard is evaluated inside this SELECT.
-- No user data, source definitions, migration statements or secrets are returned.
begin read only;
set local statement_timeout='30s';
with guards(reason_if_failed,passed) as (values
${rows.join(',\n')}
), expected_rpc(name,sha256) as (values ${expected.map(([name,hash])=>`('${name}','${hash}')`).join(',')}), rpc as (
  select e.name,e.sha256 as expected_sha256,p.oid,
    pg_get_function_identity_arguments(p.oid) as signature,p.prosecdef,p.proconfig,p.proacl,
    encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') as actual_sha256,
    (select array_agg(r.rolname||':'||a.privilege_type||':'||a.is_grantable::text order by r.rolname collate "C",a.privilege_type,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      left join pg_roles r on r.oid=a.grantee) as acl_entries
  from expected_rpc e left join (pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public') on p.proname=e.name
), rpc_checks as (
  select count(*)=2 and bool_and(coalesce(actual_sha256=expected_sha256 and prosecdef and acl_entries=array['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']::text[],false)) as passed from rpc
)
select jsonb_build_object(
  'packet','326-to-328',
  'target_requires_owner_ui_confirmation','jeugfyaqzfgdvfhdxfht / quest-platform-staging',
  'database',current_database(),
  'transaction_read_only',current_setting('transaction_read_only'),
  'all_original_guards_passed',(select bool_and(passed) from guards),
  'failed_guards',(select coalesce(jsonb_agg(reason_if_failed),'[]'::jsonb) from guards where not passed),
  'history_count',(select count(*) from supabase_migrations.schema_migrations),
  'history_sha256_lf',(select encode(sha256(convert_to(string_agg(version,chr(10) order by version collate "C"),'UTF8')),'hex') from supabase_migrations.schema_migrations),
  'rpc_hashes_and_acl_match',(select passed from rpc_checks),
  'rpc',(select jsonb_agg(jsonb_build_object('name',name,'signature',signature,'security_definer',prosecdef,'config',proconfig,'acl',proacl,'actual_sha256',actual_sha256,'expected_sha256',expected_sha256) order by name) from rpc),
  'preflight_passed',(select bool_and(passed) from guards) and (select passed from rpc_checks) and current_setting('transaction_read_only')='on'
) as preflight_summary;
rollback;
`)
console.log('Generated single-result preflight; no execution or change to 01/02/03.')
