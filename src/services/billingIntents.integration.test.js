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

test.skipIf(!enabled).each(['same-key','stale-command','rollback'])('конкурентные намерения: %s',async mode=>{
  const owner=randomUUID(), command=randomUUID(), other=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const call=(id,action)=>`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;
    select public.request_organization_billing_intent(${org},'${id}',1,'${action}');`
  let first,second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
      period_start=now()-interval '1 day',period_end=now()+interval '29 days' where organization_id=${org};`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='intent_${owner}'; begin; ${call(command,'cancel_renewal')} select pg_sleep(6); ${mode==='rollback'?'rollback':'commit'};`)
    let holding=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='intent_${owner}' and wait_event='PgSleep';`)
      if(state.output.trim().endsWith('1')) {holding=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second=sql(`set application_name='intent_second_${owner}'; ${call(mode==='stale-command'?other:command,mode==='stale-command'?'resume_renewal':'cancel_renewal')}`)
    let blocked=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='intent_second_${owner}' and wait_event_type='Lock';`)
      if(state.output.trim().endsWith('1')) {blocked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(blocked).toBe(true)
    const [one,two]=await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    if(mode==='stale-command') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('billing revision conflict')
    } else {
      expect(two.code,two.error).toBe(0)
      const receipt=result=>result.output.split(/\r?\n/).find(line=>line.startsWith('{'))
      expect(receipt(two)).toBe(receipt(one))
    }
    const retry=await sql(call(command,'cancel_renewal'))
    expect(retry.code,retry.error).toBe(0)
    const state=await sql(`select revision||':'||cancel_at_period_end::text||':'||status from public.organization_subscriptions where organization_id=${org};
      select count(*) from public.billing_intent_commands where organization_id=${org};`)
    expect(state.code,state.error).toBe(0)
    expect(state.output.trim().split(/\r?\n/).slice(-2)).toEqual(['2:true:active','1'])
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
