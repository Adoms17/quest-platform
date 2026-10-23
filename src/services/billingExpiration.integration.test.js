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

test.skipIf(!enabled).each(['repeat','renewal','rollback'])('конкурентная фиксация истечения: %s',async mode=>{
  const owner=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const call=`set role service_role; select public.record_organization_subscription_expiration(${org},1);`
  let first,second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
      period_start=now()-interval '1 day',period_end=now()-interval '1 hour' where organization_id=${org};`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='intent_${owner}'; begin; ${mode==='renewal'?`update public.organization_subscriptions set period_end=now()+interval '1 month' where organization_id=${org};`:call} select pg_sleep(6); ${mode==='rollback'?'rollback':'commit'};`)
    let holding=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='intent_${owner}' and wait_event='PgSleep';`)
      if(state.output.trim().endsWith('1')) {holding=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second=sql(`set application_name='intent_second_${owner}'; ${call}`)
    let blocked=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='intent_second_${owner}' and wait_event_type='Lock';`)
      if(state.output.trim().endsWith('1')) {blocked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(blocked).toBe(true)
    const [one,two]=await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    if(mode==='renewal') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('billing revision conflict')
    } else {
      expect(two.code,two.error).toBe(0)
      const receipt=result=>result.output.split(/\r?\n/).find(line=>line.startsWith('{'))
      if(mode==='repeat') expect(receipt(two)).toBe(receipt(one))
      else expect(receipt(two)).not.toBe(receipt(one))
    }
    if(mode!=='renewal') {
      const retry=await sql(call)
      expect(retry.code,retry.error).toBe(0)
      expect(retry.output.split(/\r?\n/).find(line=>line.startsWith('{'))).toBe(two.output.split(/\r?\n/).find(line=>line.startsWith('{')))
    }
    const state=await sql(`select revision||':'||status from public.organization_subscriptions where organization_id=${org};
      select count(*) from public.billing_expiration_events where organization_id=${org};`)
    expect(state.code,state.error).toBe(0)
    expect(state.output.trim().split(/\r?\n/).slice(-2)).toEqual(mode==='renewal'?['2:active','0']:['2:expired','1'])
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
