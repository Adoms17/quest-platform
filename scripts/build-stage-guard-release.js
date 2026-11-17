import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {verifyProductionCandidate} from './verify-production-candidate-manifest.js'
export const guardVersion='20261003000000'
export const guardName='adopt_billing_environment_guard'
const root=new URL('../',import.meta.url)
const quote=s=>"'"+s.replaceAll("'","''")+"'"
export function buildGuardRelease({projectRef,mode='preview'}={}) {
 if(projectRef!=='jeugfyaqzfgdvfhdxfht')throw Error('Stage project required')
 if(!['preview','apply'].includes(mode))throw Error('Unknown release mode')
 const {migrations}=verifyProductionCandidate()
 const manifest=JSON.parse(readFileSync(new URL('docs/tasks/PROD-PAY-05-guard-migration.json',root),'utf8'))
 const source=readFileSync(new URL(manifest.path,root),'utf8').replaceAll('\r\n','\n')
 if(manifest.version!==guardVersion || manifest.name!==guardName
  || manifest.path!=='supabase/release-migrations/'+guardVersion+'_'+guardName+'.sql'
  || createHash('sha256').update(source).digest('hex')!==manifest.sha256)throw Error('Guard migration integrity mismatch')
 const versions=migrations.map(x=>quote(x.version)).join(',')
 const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
 return `-- Stage-only reviewed release. Verify project and drain Edge calls before execution.
-- Catalog equality is checked even when the version is already recorded.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(151,1);
lock table supabase_migrations.schema_migrations in exclusive mode;
do $history$
begin
 if (select array_agg(version order by version) from supabase_migrations.schema_migrations where version<>'${guardVersion}')
   is distinct from array[${versions}]::text[] then raise exception 'guard release history mismatch'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='${guardVersion}'
  and (name is distinct from '${guardName}' or statements is distinct from array[${quote(source)}]::text[]))
 then raise exception 'guard release recorded content mismatch'; end if;
 if to_regclass('platform_private.billing_runtime_environment') is null then
  raise exception 'stage guard must already exist'; end if;
 if (select count(*) from platform_private.billing_runtime_environment where singleton and environment='sandbox')<>1 then
  raise exception 'stage sandbox identity required'; end if;
 if exists(select 1 from cron.job where active)
  or exists(select 1 from public.billing_sandbox_settlement_schedule where enabled)
  or exists(select 1 from public.billing_sandbox_reconciliation_jobs where lease_until>clock_timestamp())
  or exists(select 1 from net.http_request_queue)
 then raise exception 'guard release workers not quiescent'; end if;
end; $history$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${guardVersion}','${guardName}',array[${quote(source)}]::text[])
 on conflict(version) do nothing;
select '${guardVersion}' as version, '${mode}' as mode;
${mode==='apply'?'commit':'rollback'};
`
}
