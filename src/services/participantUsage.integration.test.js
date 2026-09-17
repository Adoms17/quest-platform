// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

// Только явно запрошенный тест локального контейнера; без URL и секретов.
const enabled = process.env.RUN_LOCAL_QUOTA_E2E === '1'
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform',
      'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = ''
    let error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output, error }))
    child.stdin.end(`set statement_timeout='15s';\n${query}`)
  })
}

test.skipIf(!enabled).each(['different-quests', 'same-offline-key'])('конкурентные регистрации: %s', async mode => {
  const owner = randomUUID(), q1 = randomUUID(), q2 = randomUUID()
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  let first, second
  const start = quest => `select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;
    ${mode === 'same-offline-key'
      ? `select public.register_offline_quest_attempt('${q1}','${owner}','local-concurrent')->>'id';`
      : `select id from public.start_quest_attempt_for_participant('${quest}','${owner}');`}`
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      insert into public.quests(id,creator_id,organization_id,title,is_open,is_public) values
      ('${q1}','${owner}',${org},'Usage concurrency',true,true),('${q2}','${owner}',${org},'Usage concurrency',true,true);`)
    expect(setup.code, setup.error).toBe(0)
    first = sql(`set application_name='usage_${owner}'; begin; ${start(q1)} select pg_sleep(6); commit;`)
    let holding = false
    for (let i=0; i<20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='usage_${owner}' and wait_event='PgSleep';`)
      if (state.output.trim().endsWith('1')) { holding=true; break }
      await new Promise(resolve => setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second = sql(`set application_name='usage_second_${owner}'; ${start(q2)}`)
    if (mode === 'same-offline-key') {
      let blocked = false
      for (let i=0; i<20; i++) {
        const state = await sql(`select count(*) from pg_stat_activity where application_name='usage_second_${owner}' and wait_event_type='Lock';`)
        if (state.output.trim().endsWith('1')) { blocked=true; break }
        await new Promise(resolve => setTimeout(resolve,50))
      }
      expect(blocked).toBe(true)
    }
    const [one,two] = await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    expect(two.code,two.error).toBe(0)
    const retry = await sql(start(q1))
    expect(retry.code,retry.error).toBe(0)
    const facts = await sql(`select count(*) from public.participant_usage_registrations where organization_id=${org};`)
    expect(facts.output.trim().endsWith(mode === 'same-offline-key' ? '1' : '2')).toBe(true)
    if (mode === 'same-offline-key') {
      const count = await sql(`select count(*) from public.offline_attempt_registrations where actor_user_id='${owner}';`)
      expect(count.output.trim().endsWith('1')).toBe(true)
    }
    const usage = await sql(`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;
      select public.get_monthly_participant_usage(${org})->>'participants';`)
    expect(usage.code,usage.error).toBe(0)
    expect(usage.output.trim().endsWith('1')).toBe(true)
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup = await sql(`delete from public.quests where id in ('${q1}','${q2}');
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
