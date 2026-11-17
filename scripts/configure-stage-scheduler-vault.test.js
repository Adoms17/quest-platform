// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { configureStageSchedulerVault } from './configure-stage-scheduler-vault.mjs'
const env = { SUPABASE_PROJECT_ID: 'jeugfyaqzfgdvfhdxfht', GITHUB_REF: 'refs/heads/staging', SUPABASE_ACCESS_TOKEN: 'synthetic-access', YOOKASSA_SANDBOX_WORKER_TOKEN: 'ab'.repeat(32) }
it.each([
  { SUPABASE_PROJECT_ID: 'another-project' }, { GITHUB_REF: 'refs/heads/main' },
  { SUPABASE_ACCESS_TOKEN: '' }, { YOOKASSA_SANDBOX_WORKER_TOKEN: '' },
  { YOOKASSA_SANDBOX_WORKER_TOKEN: "'; select 1; --" },
])('rejects invalid scope or credentials before invoking SQL: %j', async patch => {
  const execute = vi.fn()
  await expect(configureStageSchedulerVault({ ...env, ...patch }, execute)).rejects.toThrow('stage_vault_configuration_rejected')
  expect(execute).not.toHaveBeenCalled()
})
it('does not leak raw executor errors, SQL or credentials', async () => {
  await expect(configureStageSchedulerVault(env, async () => { throw Error(env.YOOKASSA_SANDBOX_WORKER_TOKEN) })).rejects.toThrow(/^stage_vault_configuration_failed$/)
})
it('provisions with disabled/signed guards and no rotation or scheduling', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)
  expect(await configureStageSchedulerVault(env, execute)).toEqual({ configured: true, scheduleEnabled: false })
  const sql = execute.mock.calls[0][0]
  expect(sql).toContain('pg_try_advisory_xact_lock(24092026,7)')
  expect(sql).toContain('scheduler must be disabled')
  expect(sql).toContain('signed scheduler required')
  expect(sql).toContain('secret mismatch; rotation not allowed')
  expect(sql).not.toMatch(/vault\.update_secret|cron\.alter_job|net\.http_post/)
})