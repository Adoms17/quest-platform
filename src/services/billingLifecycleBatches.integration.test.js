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


test.skipIf(!enabled).each(['confirmation-first','expiration-first','expiration-rollback'])('пачки на границе: %s',async mode=>{
  const owner=randomUUID(), confirmation=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const confirm='set role service_role; select public.process_due_billing_confirmations(1);'
  const expire='set role service_role; select public.process_subscription_expirations(1);'
  let first,second
  try {
    // Пачки глобальные: при чужой работе прекращаем тест до создания фикстуры.
    const guard=await sql(`select (select count(*) from public.organization_subscriptions where status in ('active','trial') and period_end<=now())+(select count(*) from public.billing_confirmation_inbox where state in ('pending','deferred') and period_start<=now());`)
    expect(guard.code,guard.error).toBe(0)
    expect(guard.output.trim().endsWith('\n0')).toBe(true)
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),period_start=now()-interval '2 days',period_end=now()-interval '1 day' where organization_id=${org};
      select public.enqueue_billing_confirmation(${org},'${confirmation}',1,(select id from public.billing_plan_versions where plan_key='pro' and version=1),(select period_start from public.organization_subscriptions where organization_id=${org}),now()+interval '29 days');`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='boundary_${owner}'; begin; ${mode==='confirmation-first'?confirm:expire} select pg_sleep(6); ${mode==='expiration-rollback'?'rollback':'commit'};`)
    let holding=false
    for(let i=0;i<20;i++) {
      const check=await sql(`select count(*) from pg_stat_activity where application_name='boundary_${owner}' and wait_event='PgSleep';`)
      if(check.output.trim().endsWith('1')) {holding=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second=sql(mode==='confirmation-first'?expire:confirm)
    const [one,two]=await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    expect(two.code,two.error).toBe(0)
    const retry=await sql(confirm)
    expect(retry.code,retry.error).toBe(0)
    const state=await sql(`select s.status||':'||s.revision||':'||i.state||':'||coalesce(i.reason,'none') from public.organization_subscriptions s join public.billing_confirmation_inbox i on i.organization_id=s.organization_id where i.confirmation_id='${confirmation}';
      select count(*) from public.billing_period_confirmations where organization_id=${org};
      select count(*) from public.billing_expiration_events where organization_id=${org};`)
    expect(state.code,state.error).toBe(0)
    expect(state.output.trim().split(/\r?\n/).slice(-3)).toEqual(mode==='expiration-first'?['active:3:applied:none','1','1']:['active:2:applied:none','1','0'])
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.organizations where personal_owner_id='${owner}'; delete from public.participant_profiles where created_by_user_id='${owner}'; delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
