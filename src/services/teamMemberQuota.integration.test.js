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

test.skipIf(!enabled).each(['commit', 'rollback'])('конкурентные активации команды после %s первой транзакции', async (ending) => {
  const owner = randomUUID()
  const member = randomUUID()
  const firstMember = randomUUID()
  const secondMember = randomUUID()
  const appName = `quota_${owner}`
  let first
  let second
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  try {
    const setup = await sql(`
      insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='active', period_start=now()-interval '1 day', period_end=now()+interval '1 day', team_member_quota_enabled=true,
        plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1)
        where organization_id=${org};
      insert into auth.users(id,email) values('${member}','${member}@example.test'),('${firstMember}','${firstMember}@example.test'),('${secondMember}','${secondMember}@example.test');
      insert into public.organization_memberships(organization_id,user_id,status) values
        (${org},'${member}','active'),(${org},'${firstMember}','suspended'),(${org},'${secondMember}','suspended');`)
    expect(setup.code, setup.error).toBe(0)
    first = sql(`set application_name='${appName}'; begin;
      update public.organization_memberships set status='active' where organization_id=${org} and user_id='${firstMember}';
      select pg_sleep(6); ${ending};`)
    let holding = false
    for (let i = 0; i < 20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='${appName}' and wait_event='PgSleep';`)
      if (state.output.trim().endsWith('1')) { holding = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(holding, 'первая транзакция удерживает блокировку до старта второй').toBe(true)
    second = sql(`set application_name='${appName}_second'; update public.organization_memberships set status='active' where organization_id=${org} and user_id='${secondMember}';`)
    let blocked = false
    for (let i = 0; i < 20; i++) {
      const state = await sql(`select count(*) from pg_stat_activity where application_name='${appName}_second' and wait_event_type='Lock';`)
      if (state.output.trim().endsWith('1')) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(blocked, 'вторая транзакция действительно ожидает блокировку').toBe(true)
    const [one, two] = await Promise.all([first, second])
    expect(one.code, one.error).toBe(0)
    if (ending === 'commit') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('team member quota exceeded')
      const retry = await sql(`update public.organization_memberships set status='suspended' where organization_id=${org} and user_id='${firstMember}';
        update public.organization_memberships set status='active' where organization_id=${org} and user_id='${secondMember}';`)
      expect(retry.code, retry.error).toBe(0)
    } else {
      expect(two.code, two.error).toBe(0)
    }
    const replay = await sql(`update public.organization_memberships set status='active' where organization_id=${org} and user_id='${secondMember}';`)
    expect(replay.code, replay.error).toBe(0)
    const isolation = await sql(`begin isolation level repeatable read;
      update public.organization_memberships set status='active' where organization_id=${org} and user_id='${firstMember}'; commit;`)
    expect(isolation.code).not.toBe(0)
    expect(isolation.error).toContain('team quota requires read committed')
    const count = await sql(`select count(*) from public.organization_memberships where organization_id=${org} and status='active';`)
    expect(count.output.trim().endsWith('3')).toBe(true)
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    const ids = [owner, member, firstMember, secondMember].map(id => `'${id}'`).join(',')
    const cleanup = await sql(`delete from public.organizations where personal_owner_id in (${ids});
      delete from public.participant_profiles where created_by_user_id in (${ids});
      delete from public.profiles where id in (${ids});
      delete from auth.users where id in (${ids});`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 60000)
