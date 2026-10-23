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

test.skipIf(!enabled).each(['commit', 'rollback'])('конкурентные открытия после %s первой транзакции', async (ending) => {
  const owner = randomUUID()
  const firstQuest = randomUUID()
  const secondQuest = randomUUID()
  const appName = `quota_${owner}`
  let first
  let second
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  try {
    const setup = await sql(`
      insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='free', active_quest_quota_enabled=true,
        plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1)
        where organization_id=${org};
      insert into public.quests(id,creator_id,organization_id,title,is_open) values
        ('${firstQuest}','${owner}',${org},'Concurrency fixture',false),
        ('${secondQuest}','${owner}',${org},'Concurrency fixture',false);`)
    expect(setup.code, setup.error).toBe(0)
    first = sql(`set application_name='${appName}'; begin;
      update public.quests set is_open=true where id='${firstQuest}';
      select pg_sleep(4); ${ending};`)
    let holding = false
    for (let i = 0; i < 20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='${appName}' and wait_event='PgSleep';`)
      if (state.output.trim().endsWith('1')) { holding = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(holding, 'первая транзакция удерживает блокировку до старта второй').toBe(true)
    second = sql(`update public.quests set is_open=true where id='${secondQuest}';`)
    const [one, two] = await Promise.all([first, second])
    expect(one.code, one.error).toBe(0)
    if (ending === 'commit') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('active quest quota exceeded')
      const retry = await sql(`update public.quests set is_open=false where id='${firstQuest}';
        update public.quests set is_open=true where id='${secondQuest}';`)
      expect(retry.code, retry.error).toBe(0)
    } else {
      expect(two.code, two.error).toBe(0)
    }
    const replay = await sql(`update public.quests set is_open=true where id='${secondQuest}';`)
    expect(replay.code, replay.error).toBe(0)
    const isolation = await sql(`begin isolation level repeatable read;
      update public.quests set is_open=true where id='${firstQuest}'; commit;`)
    expect(isolation.code).not.toBe(0)
    expect(isolation.error).toContain('quest quota requires read committed')
    const count = await sql(`select count(*) from public.quests where organization_id=${org} and is_open;`)
    expect(count.output.trim().endsWith('1')).toBe(true)
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    const cleanup = await sql(`delete from public.quests where id in ('${firstQuest}','${secondQuest}');
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}';
      delete from auth.users where id='${owner}';`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 60000)
