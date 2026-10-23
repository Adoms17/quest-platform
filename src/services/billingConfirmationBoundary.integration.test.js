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


test.skipIf(!enabled)('будущее подтверждение применяется по серверному времени без смены параметров',async()=>{
  const owner=randomUUID(), event=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      select public.enqueue_billing_confirmation(${org},'${event}',0,(select id from public.billing_plan_versions where plan_key='pro' and version=1),clock_timestamp()+interval '4 seconds',clock_timestamp()+interval '1 day');
      set role service_role; select public.process_billing_confirmation('${event}');`)
    expect(setup.code,setup.error).toBe(0)
    const receipts=r=>r.output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
    expect(receipts(setup).at(-1).state).toBe('deferred')
    const after=await sql(`select pg_sleep(5); set role service_role; select public.process_billing_confirmation('${event}');`)
    expect(after.code,after.error).toBe(0)
    expect(receipts(after).at(-1).state).toBe('applied')
    const retry=await sql(`set role service_role; select public.process_billing_confirmation('${event}');`)
    expect(retry.code,retry.error).toBe(0)
    expect(receipts(retry).at(-1)).toEqual(receipts(after).at(-1))
    const state=await sql(`select s.revision||':'||s.status||':'||i.expected_revision from public.organization_subscriptions s join public.billing_confirmation_inbox i on i.organization_id=s.organization_id where i.confirmation_id='${event}';
      select count(*) from public.billing_period_confirmations where confirmation_id='${event}';`)
    expect(state.code,state.error).toBe(0)
    expect(state.output.trim().split(/\r?\n/).slice(-2)).toEqual(['1:active:0','1'])
  } finally {
    const cleanup=await sql(`delete from public.organizations where personal_owner_id='${owner}'; delete from public.participant_profiles where created_by_user_id='${owner}'; delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},60000)
