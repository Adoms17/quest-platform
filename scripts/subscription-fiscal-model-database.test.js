// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 60000 })
  if (result.status !== 0) throw new Error(result.stderr || 'Docker failed')
  return result.stdout
}

test.skipIf(process.env.QVESTA_TEST_RECEIPTS !== '1')('subscription fiscal storage: additive migration and closed access', async () => {
  const name = 'qvesta-model-test-' + randomUUID().replaceAll('-', '')
  let created = false
  try {
    docker(['run', '-d', '--name', name, '--tmpfs', '/tmp', '--entrypoint', 'sh', 'supabase/postgres:17.6.1.165', '-c',
      'mkdir -p /tmp/test-pg; chown postgres:postgres /tmp/test-pg; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/test-pg'])
    created = true
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { docker(['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break }
      catch { await new Promise(resolve => setTimeout(resolve, 500)) }
    }
    if (!ready) throw new Error('Postgres not ready')
    const sql = input => docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input)
    const file = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    // Minimal order fixture: this test verifies storage, not production Auth/RPC integration.
    sql("create role anon; create role authenticated; create role service_role bypassrls; create extension pgtap; create table public.billing_sandbox_orders(id uuid primary key,shop_id text,amount_minor bigint,currency text,state text,first_sent_at timestamptz,period_start timestamptz,period_end timestamptz);")
    sql(file('../supabase/migrations/20260926019000_receipt_snapshot_storage.sql'))
    sql("insert into public.billing_sandbox_orders values('11111111-1111-4111-8111-111111111111','123',100,'RUB','reserved',null,now(),now()+interval '1 month'); insert into public.billing_fiscal_policies(id,environment,shop_id,effective_at,vat_code,payment_subject,payment_mode) values('22222222-2222-4222-8222-222222222222','sandbox','123',now()-interval '1 hour',1,'service','full_prepayment'); insert into public.billing_receipt_snapshots(order_id,policy_id,email,description) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','buyer@example.test','Legacy'); create table legacy_snapshot as select to_jsonb(s)::text body from public.billing_receipt_snapshots s;")
    sql(file('../supabase/migrations/20260927010000_subscription_fiscal_model_storage.sql'))
    const output = sql(file('../supabase/tests/database/subscription_fiscal_model_storage.test.sql'))
    expect(output).not.toMatch(/not ok|Looks like/)
    expect(output).toContain('1..35')
  } finally {
    if (created) docker(['rm', '-f', name])
  }
}, 90000)
