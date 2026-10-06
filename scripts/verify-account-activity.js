// Called only by the owner-checked, network-none disposable baseline harness.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'

export async function verifyAccountActivity({ sql, databaseId }) {
  if (!/^[a-f0-9]{64}$/.test(databaseId)) throw new Error('Full disposable container ID required')
  sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated;')
  const tap = sql("set search_path=public,extensions;\n" + readFileSync(new URL('../supabase/tests/database/account_activity.test.sql', import.meta.url), 'utf8'))
  expect(tap).not.toMatch(/not ok|Bail out!/)
  expect(tap).toMatch(/1\.\.21/)

  const a = "md5('activity-concurrent-a')::uuid", b = "md5('activity-concurrent-b')::uuid"
  sql(`insert into auth.users(id,email) values (${a},'concurrent-a@example.test'),(${b},'concurrent-b@example.test');`)
  // Test-only counter proves physical INSERT/UPDATE count, never part of product schema.
  sql(`create table public.activity_test_writes(account_id uuid primary key, writes integer not null);
    create function public.count_activity_test_write() returns trigger language plpgsql as $$begin
      insert into public.activity_test_writes values(new.account_id,1)
      on conflict(account_id) do update set writes=activity_test_writes.writes+1; return new; end$$;
    create trigger activity_test_count after insert or update on public.account_activity
      for each row execute function public.count_activity_test_write();`)

  const concurrentSql = input => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', databaseId, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output='', error=''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({code,output,error}))
    child.stdin.end("set statement_timeout='15s';" + input)
  })
  const call = actor => `select set_config('request.jwt.claim.sub',(${actor})::text,false);set role authenticated;select public.record_my_account_activity();`
  for (const mode of ['first-insert', 'fresh-repeat', 'expired-update']) {
    if (mode==='expired-update') {
      sql(`update public.account_activity set last_activity_at=now()-interval '25 hours' where account_id=${a};`)
    }
    const before = Number(sql(`select coalesce((select writes from public.activity_test_writes where account_id=${a}),0)`).trim())
    // Holder makes all six competing sessions overlap behind the same row lock.
    const holder = concurrentSql(`set application_name='account_activity_holder';begin;${call(a)}select pg_sleep(3);commit;`)
    let holding=false
    for(let retry=0;retry<40;retry++) {
      if(sql("select count(*) from pg_stat_activity where application_name='account_activity_holder' and wait_event='PgSleep'").trim()==='1'){holding=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    const competitors = Array.from({length:6},()=>concurrentSql(call(a)))
    let blocked=false
    for(let retry=0;retry<30;retry++) {
      if(Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%record_my_account_activity%'").trim())>0){blocked=true;break}
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    const results=await Promise.all([holder,...competitors])
    expect(holding,mode+' holder started').toBe(true)
    expect(blocked,mode+' competing requests overlap').toBe(true)
    for(const result of results) expect(result.code,result.error).toBe(0)
    const after = Number(sql(`select writes from public.activity_test_writes where account_id=${a}`).trim())
    expect(after-before,mode).toBe(mode==='fresh-repeat'?0:1)
    expect(sql(`select count(*) from public.account_activity where account_id=${a}`).trim()).toBe('1')
  }
  expect((await concurrentSql(call(b))).code).toBe(0)
  expect(sql(`select count(*) from public.account_activity where account_id in (${a},${b})`).trim()).toBe('2')
  expect(sql(`select writes from public.activity_test_writes where account_id=${b}`).trim()).toBe('1')
}
