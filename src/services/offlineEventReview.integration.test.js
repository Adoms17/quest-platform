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


test.skipIf(!enabled).each(['commit','rollback','conflict'])('архив offline: %s', async mode => {
  const owner=randomUUID(),quest=randomUUID(),event=randomUUID(),task=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const call=value=>`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;
    select public.preserve_closed_offline_events('${quest}','${owner}','local',jsonb_build_array(jsonb_build_object('clientEventId','${event}','taskId','${task}','eventType','answer','submittedValue','${value}')));`
  let first,second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test'); insert into public.quests(id,creator_id,organization_id,title,is_open,is_public) values('${quest}','${owner}',${org},'Review concurrency',false,true);`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='review_first_${owner}'; begin; ${call('value')} select pg_sleep(4); ${mode==='rollback'?'rollback':'commit'};`)
    let holding=false
    for(let i=0;i<30;i++) {
      const check=await sql(`select count(*) from pg_stat_activity where application_name='review_first_${owner}' and wait_event='PgSleep';`)
      if(check.output.trim().endsWith('1')) {holding=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second=sql(`set application_name='review_second_${owner}'; ${call(mode==='conflict'?'changed':'value')}`)
    let blocked=false
    for(let i=0;i<30;i++) {
      const check=await sql(`select count(*) from pg_stat_activity where application_name='review_second_${owner}' and wait_event_type='Lock';`)
      if(check.output.trim().endsWith('1')) {blocked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(blocked).toBe(true)
    const [a,b]=await Promise.all([first,second])
    expect(a.code,a.error).toBe(0)
    if(mode==='conflict') {expect(b.code).not.toBe(0);expect(b.error).toContain('offline review event conflict')}
    else expect(b.code,b.error).toBe(0)
    const state=await sql(`select count(*) from public.offline_event_reviews where actor_user_id='${owner}'; select count(*) from public.quest_attempts where quest_id='${quest}';`)
    expect(state.output.trim().split(/\r?\n/).slice(-2)).toEqual(['1','0'])
    const retry=await sql(call('value'))
    expect(retry.code,retry.error).toBe(0)
    if(mode==='commit') expect(retry.output.split(/\r?\n/).find(line=>line.startsWith('{'))).toBe(a.output.split(/\r?\n/).find(line=>line.startsWith('{')))
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.offline_event_reviews where actor_user_id='${owner}'; delete from public.quests where id='${quest}'; delete from public.organizations where personal_owner_id='${owner}'; delete from public.participant_profiles where created_by_user_id='${owner}'; delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},45000)
