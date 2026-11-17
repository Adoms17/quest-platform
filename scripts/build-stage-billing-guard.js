import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyProductionCandidate } from './verify-production-candidate-manifest.js'
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
export function buildStageBillingGuard({root=defaultRoot,projectRef}={}){
 if(projectRef!=='jeugfyaqzfgdvfhdxfht')throw Error('Stage project required')
 const {manifest}=verifyProductionCandidate(root)
 const bodies=manifest.files.map(({path})=>{
  const source=readFileSync(resolve(root,path),'utf8').replaceAll('\r\n','\n')
  if((source.match(/^begin;\s*$/gm)||[]).length!==1||(source.match(/^commit;\s*$/gm)||[]).length!==1)throw Error('Unexpected candidate transaction boundaries')
  return source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'').trim()
 })
 return `-- OFFLINE STAGE CANDIDATE. Not a deployment command.
-- Executor must independently verify project, exact SHA, quiescent workers and history.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(151,1);
${bodies.join('\n\n')}
insert into platform_private.billing_runtime_environment(environment) values('sandbox');
do $verify_stage$
begin
 if (select count(*) from platform_private.billing_runtime_environment where environment='sandbox')<>1 then
  raise exception 'stage environment initialization failed'; end if;
end; $verify_stage$;
commit;
`
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node build-stage-billing-guard.js <stage-project-ref>')
 process.stdout.write(buildStageBillingGuard({projectRef:process.argv[2]}))
}
