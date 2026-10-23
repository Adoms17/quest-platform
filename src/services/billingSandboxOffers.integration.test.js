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

test.skipIf(!enabled).each(['retry', 'another_command'])('sandbox offer acceptance concurrency: %s', async mode => {
  const owner = randomUUID(), command = randomUUID()
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  const offer = randomUUID()
  const reserve = key => `select set_config('request.jwt.claim.sub','${owner}',true);
    select jsonb_build_object('id',public.accept_sandbox_checkout_offer(${org},'${offer}','${key}'));`
  let first, second
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');`)
    expect(setup.code, setup.error).toBe(0)
    const quote = await sql(`insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until)
      select '${offer}',${org},id,0,100,'123','https://stage.qvesta.ru',now(),now()+interval '1 day',now()+interval '1 hour' from public.billing_plan_versions where plan_key='pro' and version=1;`)
    expect(quote.code,quote.error).toBe(0)
    const firstName = `sandbox_first_${owner}`, secondName = `sandbox_second_${owner}`
    first = sql(`set application_name='${firstName}'; begin; ${reserve(command)} select pg_sleep(7); commit;`)
    await waitFor(firstName, "wait_event='PgSleep'")
    second = sql(`set application_name='${secondName}'; begin; ${reserve(mode === 'retry' ? command : randomUUID())} commit;`)
    await waitFor(secondName, "wait_event_type='Lock'")
    const [a,b] = await Promise.all([first,second])
    expect(a.code,a.error).toBe(0)
    if (mode === 'retry') {
      expect(b.code,b.error).toBe(0)
      const receipt = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')))
      expect(receipt(a.output)).toEqual(receipt(b.output))
    } else {
      expect(b.code).not.toBe(0)
      expect(b.error).toContain('sandbox order already pending')
    }
    const state = await sql(`select count(*) from public.billing_sandbox_orders where organization_id=${org};`)
    expect(state.output.trim().split(/\r?\n/).at(-1)).toBe('1')
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup = await sql(`delete from public.billing_sandbox_orders where organization_id=${org};
      delete from public.billing_sandbox_offers where organization_id=${org};
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},45000)