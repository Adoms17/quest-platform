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

test.skipIf(!enabled).each(['commit', 'online', 'rollback'])('конкурентное погашение offline-права: %s', async mode => {
  const owner = randomUUID(), quest = randomUUID(), command1 = randomUUID()
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  const call = () => `set role service_role; select set_config('request.jwt.claim.sub','${owner}',false);
    select public.redeem_offline_start_permit((select id from public.offline_start_permits where quest_id='${quest}'));`
  const receipt = result => JSON.parse(result.output.split(/\r?\n/).find(line => line.startsWith('{')))
  let first, second
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1) where organization_id=${org};
      insert into public.quests(id,creator_id,organization_id,title,is_open,is_public) values('${quest}','${owner}',${org},'Permit test',true,true);
      set role service_role; select set_config('request.jwt.claim.sub','${owner}',false);
      select public.prepare_offline_start_permit('${quest}','${owner}','${command1}');`)
    expect(setup.code, setup.error).toBe(0)
    first = sql(`set application_name='permit_first_${owner}'; begin; ${call()} select pg_sleep(4); ${mode === 'rollback' ? 'rollback' : 'commit'};`)
    let holding = false
    for (let i = 0; i < 20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='permit_first_${owner}' and wait_event='PgSleep';`)
      if (state.output.trim().endsWith('1')) { holding = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(holding).toBe(true)
    second = sql(`set application_name='permit_second_${owner}'; ${mode === 'online'
      ? `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); select jsonb_build_object('id',a.id) from public.start_quest_attempt('${quest}') a;`
      : call()}`)
    let blocked = false
    for (let i = 0; i < 20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='permit_second_${owner}' and wait_event_type='Lock';`)
      if (state.output.trim().endsWith('1')) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(blocked).toBe(true)
    const [one, two] = await Promise.all([first, second])
    expect(one.code, one.error).toBe(0)
    expect(two.code, two.error).toBe(0)
    if (mode !== 'rollback') expect(receipt(two).id).toBe(receipt(one).id)
    else expect(receipt(two).id).not.toBe(receipt(one).id)
    const retry = await sql(call())
    expect(retry.code, retry.error).toBe(0)
    expect(receipt(retry).id).toBe(receipt(two).id)
    const counts = await sql(`select count(*) from public.offline_start_permits where quest_id='${quest}';
      select count(*) from public.offline_start_permit_requests where quest_id='${quest}';
      select count(*) from public.quest_attempts where quest_id='${quest}';`)
    expect(counts.code, counts.error).toBe(0)
    expect(counts.output.trim().split(/\r?\n/).slice(-3)).toEqual(['1', '1', '1'])
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    const cleanup = await sql(`delete from public.offline_start_permit_requests where quest_id='${quest}';
      delete from public.offline_start_permits where quest_id='${quest}'; delete from public.quest_attempts where quest_id='${quest}'; delete from public.quests where id='${quest}';
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 60000)
