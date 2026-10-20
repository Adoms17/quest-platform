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

test.skipIf(!enabled).each([false,true])('одинаковый ключ создания, копия=%s', async copy => {
  const owner=randomUUID(), source=randomUUID(), operation=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const call=`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;
    select public.create_organization_quest(${org},'${operation}','${copy ? '{}' : '{"title":"Concurrent draft"}'}',${copy ? `'${source}'` : 'null'});`
  let first, second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      insert into public.quests(id,creator_id,organization_id,title,is_open) values('${source}','${owner}',${org},'Source',false);
      insert into public.tasks(quest_id,title) values('${source}','One'),('${source}','Two');`)
    expect(setup.code,setup.error).toBe(0)
    first=sql(`set application_name='create_${owner}'; begin; ${call} select pg_sleep(6); commit;`)
    let holding=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='create_${owner}' and wait_event='PgSleep';`)
      if(state.output.trim().endsWith('1')) { holding=true; break }
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(holding).toBe(true)
    second=sql(`set application_name='create_second_${owner}'; ${call}`)
    let blocked=false
    for(let i=0;i<20;i++) {
      const state=await sql(`select count(*) from pg_stat_activity where application_name='create_second_${owner}' and wait_event_type='Lock';`)
      if(state.output.trim().endsWith('1')) { blocked=true; break }
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    expect(blocked).toBe(true)
    const results=await Promise.all([first,second])
    for(const result of results) expect(result.code,result.error).toBe(0)
    const retry=await sql(call)
    expect(retry.code,retry.error).toBe(0)
    const receipt=await sql(`select quest_id from public.quest_creation_requests where actor_id='${owner}' and operation_id='${operation}';`)
    const questId=receipt.output.trim().split('\n').at(-1).trim()
    expect(questId).toMatch(/^[0-9a-f-]{36}$/)
    for(const result of [...results,retry]) expect(result.output).toContain(questId)
    const counts=await sql(`select count(*) from public.quests where organization_id=${org};
      select count(*) from public.tasks where quest_id='${questId}';
      select count(*) from public.quest_creation_requests where actor_id='${owner}';`)
    expect(counts.code,counts.error).toBe(0)
    expect(counts.output.trim().split(/\r?\n/).slice(-3)).toEqual(['2',copy ? '2' : '0','1'])
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.quests where organization_id=${org};
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
