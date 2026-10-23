// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

const enabled = process.env.RUN_LOCAL_QUOTA_E2E === '1'
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform',
      'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = '', error = ''
    child.stdout.on('data', value => { output += value })
    child.stderr.on('data', value => { error += value })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output, error }))
    child.stdin.end(`set statement_timeout='15s';\n${query}`)
  })
}
async function waitFor(name, condition) {
  for (let i = 0; i < 60; i++) {
    const result = await sql(`select count(*) from pg_stat_activity where application_name='${name}' and ${condition};`)
    expect(result.code, result.error).toBe(0)
    if (result.output.trim().endsWith('1')) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Transaction did not reach ${condition}`)
}

test.skipIf(!enabled).each(['pending','succeeded'])('sandbox result concurrency: %s after success', async status => {
  const owner=randomUUID(), order=randomUUID(), payment=randomUUID()
  const org=`(select id from public.organizations where personal_owner_id='${owner}')`
  const record=s=>`select set_config('request.jwt.claim.sub','${owner}',true); select public.record_sandbox_payment_result('${order}','${payment}','${s}',${s==='succeeded'},true,null);`
  let first,second
  try {
    const setup=await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      insert into public.billing_sandbox_orders(id,organization_id,actor_id,command_id,plan_version_id,expected_revision,amount_minor,currency,shop_id,return_url,period_start,period_end,first_sent_at,state)
      values('${order}',${org},'${owner}',gen_random_uuid(),(select id from public.billing_plan_versions where plan_key='pro' and version=1),0,100,'RUB','123','https://stage.qvesta.ru',now(),now()+interval '1 month',now(),'sending');`)
    expect(setup.code,setup.error).toBe(0)
    const aName=`result_first_${owner}`,bName=`result_second_${owner}`
    first=sql(`set application_name='${aName}'; begin; ${record('succeeded')} select pg_sleep(7); commit;`)
    await waitFor(aName,"wait_event='PgSleep'")
    second=sql(`set application_name='${bName}'; begin; ${record(status)} commit;`)
    await waitFor(bName,"wait_event_type='Lock'")
    const [a,b]=await Promise.all([first,second])
    expect(a.code,a.error).toBe(0); expect(b.code,b.error).toBe(0)
    expect(b.output).toContain('"status": "succeeded"')
    const state=await sql(`select count(*) from public.billing_sandbox_payment_results where order_id='${order}' and status='succeeded';`)
    expect(state.output.trim().split(/\r?\n/).at(-1)).toBe('1')
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    const cleanup=await sql(`delete from public.billing_sandbox_payment_results where order_id='${order}'; delete from public.billing_sandbox_orders where id='${order}';
      delete from public.organizations where personal_owner_id='${owner}'; delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code,cleanup.error).toBe(0)
  }
},45000)