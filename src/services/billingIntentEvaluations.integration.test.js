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

test.skipIf(!enabled).each(['downgrade','cancel_renewal'].flatMap(kind=>['repeat','renewal','rollback','boundary'].map(mode=>({kind,mode}))))('конкурентная оценка $kind: $mode',async ({kind,mode})=>{
  const owner=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const call=`set role service_role; select public.evaluate_organization_billing_intent(${org});`
  let first,second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='active',plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
      period_start=now()-interval '2 days',period_end=${mode==='boundary'?"clock_timestamp()+interval '4 seconds'":"now()-interval '1 day'"} where organization_id=${org};
      update public.organization_subscriptions set ${kind==='cancel_renewal'?'cancel_at_period_end=true':"scheduled_plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1),scheduled_effective_at=period_end"} where organization_id=${org};`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='intent_${owner}'; begin; ${mode==='renewal'
      ? `update public.organization_subscriptions set period_end=period_end+interval '1 month' where organization_id=${org};`
      : call} select pg_sleep(6); ${mode==='rollback'?'rollback':'commit'};`)
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
    if(mode==='boundary') {
      const timing=await sql(`select query_start<period_end from pg_stat_activity cross join public.organization_subscriptions where application_name='intent_second_${owner}' and organization_id=${org};`)
      expect(timing.code,timing.error).toBe(0)
      expect(timing.output.trim().endsWith('t')).toBe(true)
    }
    const [one,two]=await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    expect(two.code,two.error).toBe(0)
    const receipt=result=>JSON.parse(result.output.split(/\r?\n/).find(line=>line.startsWith('{')))
    expect(receipt(two).outcome).toBe(mode==='renewal'?'stale':'due')
    expect(receipt(two).intent_kind).toBe(kind)
    if(mode==='boundary') {
      expect(receipt(one).outcome).toBe('scheduled')
      expect(receipt(one).recorded).toBe(false)
      expect(receipt(two).revision).toBe(receipt(one).revision)
    }
    if(mode==='repeat') expect(receipt(two)).toEqual(receipt(one))
    if(mode==='rollback') expect(receipt(two).evaluated_at).not.toBe(receipt(one).evaluated_at)
    const retry=await sql(call)
    expect(retry.code,retry.error).toBe(0)
    expect(receipt(retry)).toEqual(receipt(two))
    const state=await sql(`select revision||':'||status||':'||(select plan_key from public.billing_plan_versions where id=s.plan_version_id) from public.organization_subscriptions s where organization_id=${org};
      select count(*) from public.billing_intent_evaluations where organization_id=${org};
      select bool_and(snapshot->>'revision'=subscription_revision::text and intent_kind='${kind}' and outcome='${mode==='renewal'?'stale':'due'}') from public.billing_intent_evaluations where organization_id=${org};`)
    expect(state.code,state.error).toBe(0)
    expect(state.output.trim().split(/\r?\n/).slice(-3)).toEqual([`${mode==='renewal'?3:2}:active:pro`,'1','t'])
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
