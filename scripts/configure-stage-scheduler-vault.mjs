import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const project = 'jeugfyaqzfgdvfhdxfht'
const exec = promisify(execFile)
// Never print SQL, CLI output or underlying errors: these may contain credentials.
async function executeProtectedSql(sql) {
  const directory = await mkdtemp(join(tmpdir(), 'qvesta-vault-'))
  try {
    const file = join(directory, 'configure.sql')
    await writeFile(file, sql, { mode: 0o600 })
    await exec('node_modules/.bin/supabase', ['db', 'query', '--linked', '--project-ref', project, '--file', file],
      { timeout: 60000, maxBuffer: 1024 * 1024 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function configureStageSchedulerVault(env, executeSql = executeProtectedSql) {
  if (env.SUPABASE_PROJECT_ID !== project || env.GITHUB_REF !== 'refs/heads/staging' ||
      !env.SUPABASE_ACCESS_TOKEN || !/^[a-f0-9]{64}$/.test(env.YOOKASSA_SANDBOX_WORKER_TOKEN ?? '')) {
    throw Error('stage_vault_configuration_rejected')
  }
  const token = env.YOOKASSA_SANDBOX_WORKER_TOKEN
  try {
    await executeSql(`begin;
set local statement_timeout='15s';
set local lock_timeout='5s';
do $configure$
declare existing text; definition text;
begin
 if not pg_try_advisory_xact_lock(24092026,7) then raise exception 'scheduler busy'; end if;
 if (select count(*) from cron.job where jobname in ('quest-stage-order-reconciliation','quest-billing-lifecycle'))<>2
 or exists(select 1 from cron.job where jobname in ('quest-stage-order-reconciliation','quest-billing-lifecycle') and active)
 or exists(select 1 from public.billing_sandbox_scheduled_orders where enabled)
 then raise exception 'scheduler must be disabled'; end if;
 definition:=pg_get_functiondef('platform_private.run_scheduled_sandbox_orders()'::regprocedure);
 if position('x-qvesta-order-signature' in definition)=0 or position('x-qvesta-worker-token' in definition)>0
 then raise exception 'signed scheduler required'; end if;
 if (select count(*) from vault.secrets where name='qvesta_stage_reconcile_worker_token')>1
 then raise exception 'ambiguous secret'; end if;
 select decrypted_secret into existing from vault.decrypted_secrets where name='qvesta_stage_reconcile_worker_token';
 if found then
  if existing is distinct from '${token}' then raise exception 'secret mismatch; rotation not allowed'; end if;
 else
  perform vault.create_secret('${token}','qvesta_stage_reconcile_worker_token','Stage scoped order reconciliation');
 end if;
end; $configure$;
commit;`)
  } catch {
    throw Error('stage_vault_configuration_failed')
  }
  return { configured: true, scheduleEnabled: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await configureStageSchedulerVault(process.env))) }
  catch { console.error('Stage Vault configuration failed; credentials and raw diagnostics suppressed.'); process.exitCode = 1 }
}