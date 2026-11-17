// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

const enabled = process.env.RUN_LOCAL_QUOTA_E2E === '1'
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform',
      'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = '', error = ''
    child.stdout.on('data', value => { output += value })
    child.stderr.on('data', value => { error += value })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output, error }))
    child.stdin.end(`set statement_timeout='15s';\n${query}`)
  })
}
async function waitFor(name, condition) {
  for (let i = 0; i < 60; i++) {
    const result = await sql(`select count(*) from pg_stat_activity where application_name='${name}' and ${condition};`)
    expect(result.code, result.error).toBe(0)
    if (result.output.trim().endsWith('1')) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Transaction did not reach ${condition}`)
}

// Обе транзакции откатываются: неизменяемая история trial не загрязняется тестами.
// Проверяем реальное ожидание блокировки и освобождение права после rollback.
test.skipIf(!enabled).each(['organization', 'device', 'command'])('trial contention: %s rollback', async mode => {
  const owner = randomUUID(), other = randomUUID(), command = randomUUID()
  const device = randomUUID().replaceAll('-', '').repeat(2)
  const org = id => `(select id from public.organizations where personal_owner_id='${id}')`
  const call = (id, key) => `select set_config('request.jwt.claim.sub','${id}',true);
    select public.request_organization_trial(${org(id)},(select id from public.billing_plan_versions where plan_key='pro' and version=1),'${device}','${key}',0);`
  let first, second
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test'),('${other}','${other}@example.test');`)
    expect(setup.code, setup.error).toBe(0)
    const firstName = `trial_first_${owner}`, secondName = `trial_second_${owner}`
    first = sql(`set application_name='${firstName}'; begin; ${call(owner, command)} select pg_sleep(7); rollback;`)
    await waitFor(firstName, "wait_event='PgSleep'")
    second = sql(`set application_name='${secondName}'; begin;
      ${call(mode === 'device' ? other : owner, mode === 'command' ? command : randomUUID())}
      select count(*) from public.billing_trial_usage where device_key_hash='${device}'; rollback;`)
    await waitFor(secondName, "wait_event_type='Lock'")
    const [a, b] = await Promise.all([first, second])
    expect(a.code, a.error).toBe(0)
    expect(b.code, b.error).toBe(0)
    expect(b.output).toContain('"state": "active"')
    expect(b.output.trim().split(/\r?\n/).slice(-2)).toEqual(['1', 'ROLLBACK'])
    const state = await sql(`select count(*) from public.billing_trial_usage where device_key_hash='${device}';`)
    expect(state.output.trim().split(/\r?\n/).at(-1)).toBe('0')
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    const cleanup = await sql(`delete from public.organizations where personal_owner_id in ('${owner}','${other}');
      delete from public.participant_profiles where created_by_user_id in ('${owner}','${other}');
      delete from public.profiles where id in ('${owner}','${other}'); delete from auth.users where id in ('${owner}','${other}');`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 45000)
