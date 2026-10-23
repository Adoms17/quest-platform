import {readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve, join} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'docs/qa/staging-owner-packet-20261007')
const migrationDir = join(root, 'supabase/migrations')
const migrations = [
  ['20261006010000', 'participant_profile_identity', 'e5e691d622bd62857f244f897f5d142f4ce8a7abd197c2a9a4714184300f2612'],
  ['20261006020000', 'record_account_activity', 'dc9a0fab0445ff740c6b909a124cb52ab676bfb2d177942b7d28c19c33ac63d0'],
].map(([id, name, hash]) => {
  const bytes = readFileSync(join(migrationDir, `${id}_${name}.sql`))
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Source hash mismatch: ${id}`)
  return {id, name, hash, base64: bytes.toString('base64')}
})
const baseline = readdirSync(migrationDir).filter(n => n.endsWith('.sql') && n < '20261006010000').map(n => n.split('_')[0]).sort()
if (baseline.length !== 324 || new Set(baseline).size !== 324) throw Error('Unexpected baseline migration set')
const baselineHash = createHash('sha256').update(baseline.join('\n')).digest('hex')
const knownReleases = ['20261003000000_adopt_billing_environment_guard.sql','20261003010000_read_my_platform_sections.sql'].map(file => ({
  id:file.split('_')[0], file:`supabase/release-migrations/${file}`,
  sha256:createHash('sha256').update(readFileSync(join(root,'supabase/release-migrations',file))).digest('hex'),
}))
const currentVersions=[...baseline,...knownReleases.map(m=>m.id)].sort()
const expectedVersions=[...currentVersions,...migrations.map(m=>m.id)].sort()
const currentHash=createHash('sha256').update(currentVersions.join('\n')).digest('hex')
const prior=JSON.parse(readFileSync(join(root,'docs/tasks/PROFILE-01-stage-metadata-20261006.json'),'utf8'))
if (currentHash !== '43e62d2b3279dfe6b443c5ec1dd4d29e9d2ed720bad80b019661caea173eeceb' ||
    JSON.stringify([...prior.versions].sort())!==JSON.stringify(currentVersions)) throw Error('Known release set differs from owner report/prior snapshot')
const functions = ['can_edit_participant_identity','begin_participant_avatar','confirm_participant_avatar_upload','save_participant_identity','claim_participant_avatar_cleanup','finish_participant_avatar_cleanup','claim_failed_participant_avatar','claim_expired_participant_avatars','record_my_account_activity']
const policies = ['Read current accessible participant avatar','Fence participant avatar reads','Fence anonymous participant avatars','Fence participant avatar inserts','Fence participant avatar updates','Fence participant avatar deletes']
const quoted = values => values.map(s => `'${s}'`).join(',')
const historyHash = `encode(sha256(convert_to(coalesce(string_agg(version, chr(10) order by version collate "C"),''),'UTF8')),'hex')`
const exactHistory = (versions, label) => `
  if (select array_agg(version::text order by version::text collate "C") from supabase_migrations.schema_migrations)
     is distinct from array[${quoted(versions)}]::text[] then raise exception 'Migration history differs from approved ${label} version set; STOP without repair'; end if;
`
const releaseSnapshot = `(select jsonb_agg(to_jsonb(m) order by m.version) from supabase_migrations.schema_migrations m where version in (${quoted(knownReleases.map(m=>m.id))}))`
const guard = `
  if current_database() <> 'postgres' then raise exception 'Unexpected database'; end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Missing migration ledger; STOP'; end if;
  ${exactHistory(currentVersions,'current 326')}
  if (select count(*) from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'
      and ((column_name='version' and udt_name='text') or (column_name='name' and udt_name='text') or (column_name='statements' and udt_name='_text'))) <> 3 then
    raise exception 'Unsupported ledger layout; no guessed history writes';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('public.participant_profiles') is null then raise exception 'Missing prerequisites'; end if;
  if to_regclass('public.account_activity') is not null or to_regclass('platform_private.participant_avatar_ids') is not null
     or to_regclass('platform_private.participant_avatar_uploads') is not null then raise exception 'New relation collision'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='participant_profiles' and column_name in ('nickname','avatar_path','identity_revision')) then raise exception 'Identity column collision'; end if;
  if exists(select 1 from storage.buckets where id='participant-avatars' or name='participant-avatars') then raise exception 'Bucket collision; preserve existing objects'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${quoted(functions)})) then raise exception 'New RPC collision'; end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in (${quoted(policies)})) then raise exception 'Policy collision'; end if;
  if to_regprocedure('public.get_participant_profile_card(uuid)') is null or to_regprocedure('public.search_participant_group_members(uuid,text,jsonb,integer)') is null then raise exception 'Missing replaced RPC prerequisites'; end if;
`
const postGuard = `
  ${exactHistory(expectedVersions,'post-apply 328')}
  ${migrations.map(m=>`if not exists(select 1 from supabase_migrations.schema_migrations where version='${m.id}' and name='${m.name}' and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${m.hash}') then raise exception 'Applied source history mismatch ${m.id}'; end if;`).join('\n')}
  if not exists(select 1 from storage.buckets where id='participant-avatars' and not public and file_size_limit=1048576 and allowed_mime_types=array['image/png']) then raise exception 'Bucket invariants failed'; end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in (${quoted(policies)})) <> 6 then raise exception 'Missing Storage policies'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and (n.nspname,c.relname) in (('public','account_activity'),('platform_private','participant_avatar_ids'),('platform_private','participant_avatar_uploads'))) <> 3 then raise exception 'RLS invariants failed'; end if;
  if has_function_privilege('anon','public.record_my_account_activity()','EXECUTE') or not has_function_privilege('authenticated','public.record_my_account_activity()','EXECUTE') then raise exception 'Activity RPC ACL failed'; end if;
  if has_table_privilege('authenticated','public.account_activity','INSERT,UPDATE,DELETE') or has_table_privilege('anon','public.account_activity','SELECT') then raise exception 'Activity table ACL failed'; end if;
  if has_function_privilege('authenticated','public.confirm_participant_avatar_upload(uuid,uuid)','EXECUTE') then raise exception 'Trusted avatar RPC exposed'; end if;
`
const banner = '-- STAGING ONLY jeugfyaqzfgdvfhdxfht; code 8c9ae161d6a9d2a9c51be2940a14d945128752eb.\n-- SQL cannot independently attest the Supabase project: owner must verify Dashboard URL/header.\n'
mkdirSync(out, {recursive:true})
writeFileSync(join(out,'01-preflight.sql'), banner + `begin read only;
set local statement_timeout='30s';
do $preflight$ begin ${guard} end $preflight$;
select current_database() as database, current_user as executor, count(*) as history_count, ${historyHash} as history_versions_sha256 from supabase_migrations.schema_migrations;
select column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position;
select p.proname,pg_get_function_identity_arguments(p.oid) as signature,p.prosecdef,p.proconfig,p.proacl,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') as definition_sha256 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_participant_profile_card','search_participant_group_members') order by p.proname;
select policyname,permissive,roles,cmd from pg_policies where schemaname='storage' and tablename='objects' order by policyname;
rollback;
`)
const declarations = migrations.map((m,i) => `source${i+1} text := convert_from(decode('${m.base64}','base64'),'UTF8');`).join('\n')
const execute = migrations.map((m,i) => `
  if encode(sha256(convert_to(source${i+1},'UTF8')),'hex') <> '${m.hash}' then raise exception 'Source hash mismatch ${m.id}'; end if;
  ${i===1 ? `-- Remove only the verified migration's outer BEGIN/COMMIT so both migrations and history commit atomically.
  if source2 !~ E'(?i)\\\\mbegin;[\\\\r\\\\n]' or source2 !~ E'(?i)commit;[\\\\r\\\\n]*$' then raise exception 'Unexpected transaction envelope'; end if;
  execute regexp_replace(regexp_replace(source2, E'(?i)\\\\mbegin;[\\\\r\\\\n]', '', ''), E'(?i)commit;[\\\\r\\\\n]*$', '', '');` : 'execute source1;'}
  insert into supabase_migrations.schema_migrations(version,name,statements) values('${m.id}','${m.name}',array[source${i+1}]);`).join('\n')
writeFileSync(join(out,'02-apply.sql'),banner+`-- HOLD: review 01 output first. Replace only the owner confirmation token after checking the same Dashboard project.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $apply$
declare
  confirmed_target text := '__OWNER_CONFIRM_PROJECT_AFTER_PREFLIGHT__';
  existing_release_rows jsonb;
  ${declarations}
begin
  if confirmed_target <> 'jeugfyaqzfgdvfhdxfht' then raise exception 'Owner project confirmation missing'; end if;
  ${guard}
  existing_release_rows := ${releaseSnapshot};
  ${execute}
  ${postGuard}
  if existing_release_rows is distinct from ${releaseSnapshot} then raise exception 'Existing release history changed'; end if;
end $apply$;
commit;
`)
writeFileSync(join(out,'03-postcheck.sql'),banner+`begin read only;
set local statement_timeout='30s';
do $post$ begin ${postGuard} end $post$;
select version,name,encode(sha256(convert_to(statements[1],'UTF8')),'hex') as applied_source_sha256 from supabase_migrations.schema_migrations where version in ('20261006010000','20261006020000') order by version;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='participant-avatars';
select policyname,permissive,roles,cmd from pg_policies where (schemaname='storage' and tablename='objects' and policyname in (${quoted(policies)})) or (schemaname='public' and tablename='account_activity') order by policyname;
select p.proname,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${quoted(functions)}) order by p.proname;
rollback;
`)
for (const file of ['participant-avatar/index.ts','_shared/participantAvatarEndpoint.js','_shared/participantAvatarPng.js']) {
  const dest=join(out,'edge',file);mkdirSync(resolve(dest,'..'),{recursive:true});copyFileSync(join(root,'supabase/functions',file),dest)
}
writeFileSync(join(out,'source-manifest.json'),JSON.stringify({code:'8c9ae161d6a9d2a9c51be2940a14d945128752eb',target:'jeugfyaqzfgdvfhdxfht',baselineCount:324,baselineVersionsSha256:baselineHash,knownReleases,currentCount:326,currentVersionsSha256:currentHash,expectedAfterCount:328,expectedAfterVersionsSha256:createHash('sha256').update(expectedVersions.join('\n')).digest('hex'),migrations:migrations.map(({id,name,hash})=>({id,name,sha256:hash})),edge:{function:'participant-avatar',verify_jwt:true},remoteApplied:false},null,2)+'\n')
console.log('Prepared staging owner packet; no connection or SQL execution.')
