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


test.skipIf(!enabled)('пачка пропускает заблокированную подписку', async () => {
  const owner=randomUUID(), other=randomUUID()
  const org=id=>`(select id from public.organizations where personal_owner_id='${id}')`
  let holding
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test'),('${other}','${other}@example.test');
      update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start='0001-01-01 UTC',period_end='0001-02-01 UTC' where organization_id in(${org(owner)},${org(other)});`)
    expect(setup.code,setup.error).toBe(0)
    holding=sql(`set application_name='batch_${owner}'; begin; select organization_id from public.organization_subscriptions where organization_id=${org(owner)} for update; select pg_sleep(8); rollback;`)
    let locked=false
    for(let i=0;i<20;i++) {
      const check=await sql(`select count(*) from pg_stat_activity where application_name='batch_${owner}' and wait_event='PgSleep';`)
      if(check.output.trim().endsWith('1')) {locked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(locked).toBe(true)
    const batch=await sql('set role service_role; select public.process_subscription_expirations(1);')
    expect(batch.code,batch.error).toBe(0)
    expect(JSON.parse(batch.output.split(/\r?\n/).find(line=>line.startsWith('{'))).processed).toBe(1)
    const during=await sql(`select status from public.organization_subscriptions where organization_id=${org(owner)};
      select status from public.organization_subscriptions where organization_id=${org(other)};
      select count(*) from pg_stat_activity where application_name='batch_${owner}' and wait_event='PgSleep';`)
    expect(during.code,during.error).toBe(0)
    expect(during.output.trim().split(/\r?\n/).slice(-3)).toEqual(['active','expired','1'])
    const release=await holding
    expect(release.code,release.error).toBe(0)
    const next=await sql('set role service_role; select public.process_subscription_expirations(1);')
    expect(next.code,next.error).toBe(0)
    const final=await sql(`select count(*) from public.billing_expiration_events where organization_id in(${org(owner)},${org(other)});`)
    expect(final.code,final.error).toBe(0)
    expect(final.output.trim().endsWith('2')).toBe(true)
  } finally {
    await Promise.allSettled([holding].filter(Boolean))
    const cleanup=await sql(`delete from public.organizations where personal_owner_id in('${owner}','${other}');
      delete from public.participant_profiles where created_by_user_id in('${owner}','${other}');
      delete from public.profiles where id in('${owner}','${other}'); delete from auth.users where id in('${owner}','${other}');`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
