// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
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
    const r = await sql(`select count(*) from pg_stat_activity where application_name='${name}' and ${condition};`)
    expect(r.code, r.error).toBe(0)
    if (r.output.trim().endsWith('1')) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Expected transaction lock was not observed')
}

test.skipIf(!enabled).each(['retry', 'another_command', 'revoke'])('promotion concurrency: %s', async mode => {
  const owner = randomUUID(), promotion = randomUUID(), command = randomUUID()
  const code = randomBytes(16).toString('hex').toUpperCase()
  const hash = createHash('sha256').update(code).digest('hex')
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  const redeem = key => `select set_config('request.jwt.claim.sub','${owner}',true);
    select public.redeem_organization_promotion(${org},'${code}','${key}',0);`
  let first, second
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      insert into public.billing_promotions(id,organization_id,plan_version_id,duration_days,activate_before,code_hash,issuer_id,issue_command_id)
      values('${promotion}',${org},(select id from public.billing_plan_versions where plan_key='pro' and version=1),21,now()+interval '7 days','${hash}','${owner}',gen_random_uuid());`)
    expect(setup.code, setup.error).toBe(0)
    const firstName = `promo_first_${owner}`, secondName = `promo_second_${owner}`
    first = sql(`set application_name='${firstName}'; begin; ${redeem(command)} select pg_sleep(7); commit;`)
    await waitFor(firstName, "wait_event='PgSleep'")
    second = sql(`set application_name='${secondName}'; begin; ${mode === 'revoke'
      ? `select public.revoke_organization_promotion('${promotion}');`
      : redeem(mode === 'retry' ? command : randomUUID())} commit;`)
    await waitFor(secondName, "wait_event_type='Lock'")
    const [a, b] = await Promise.all([first, second])
    expect(a.code, a.error).toBe(0)
    if (mode === 'revoke') {
      expect(b.code).not.toBe(0)
      expect(b.error).toContain('promotion already redeemed')
    } else {
      expect(b.code, b.error).toBe(0)
      if (mode === 'retry') {
        const receipt = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')))
        expect(receipt(a.output)).toEqual(receipt(b.output))
      } else expect(b.output).toContain('revision_conflict')
    }
    const state = await sql(`select count(*) from public.billing_trial_access where promotion_id='${promotion}';
      select count(*) from public.billing_trial_usage where actor_id='${owner}';`)
    expect(state.output.trim().split(/\r?\n/).slice(-2)).toEqual(['1', '0'])
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    // Только созданные этим тестом фикстуры; пользовательские данные не затрагиваются.
    const cleanup = await sql(`update public.organization_subscriptions set trial_access_id=null where organization_id=${org};
      update public.billing_promotions set redeemed_access_id=null where id='${promotion}';
      delete from public.billing_trial_transitions where access_id in(select id from public.billing_trial_access where promotion_id='${promotion}');
      delete from public.billing_trial_access where promotion_id='${promotion}';
      delete from public.billing_promotions where id='${promotion}';
      delete from public.billing_promotion_commands where actor_id='${owner}';
      delete from public.billing_promotion_rate_limits where actor_id='${owner}';
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 45000)
