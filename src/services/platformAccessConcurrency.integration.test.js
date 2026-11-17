// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const enabled = process.env.RUN_LOCAL_PLATFORM_CONCURRENCY === '1'
const container = 'supabase_db_quest-platform'
function sql(database, query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output: output.trim(), error }))
    child.stdin.end(`set statement_timeout='20s';\n${query}`)
  })
}
async function succeeds(database, query) {
  const result = await sql(database, query)
  expect(result.code, result.error).toBe(0)
  return result.output
}
async function waitFor(database, application, event) {
  for (let i = 0; i < 40; i++) {
    const state = await succeeds(database, `select count(*) from pg_stat_activity where datname=current_database() and application_name='${application}' and wait_event='${event}';`)
    if (state === '1') return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Не подтверждено ожидание ${event}`)
}
const actorClaims = user => `select set_config('request.jwt.claim.sub','${user}',false);
 select set_config('request.jwt.claims',jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp())))))::text,false);`

test.skipIf(!enabled).each([
  ['grant', 'commit'], ['grant', 'rollback'], ['revoke', 'commit'], ['revoke', 'rollback'],
])('системные назначения: %s при %s первой транзакции', async (operation, ending) => {
  // Отдельная новая БД, никаких копий данных существующего стенда.
  const database = `qvesta_admin_test_${randomUUID().replaceAll('-', '')}`
  const ownerA = randomUUID(), ownerB = randomUUID(), target = randomUUID(), command = randomUUID()
  const assignmentA = randomUUID(), assignmentB = randomUUID()
  let created = false, first, second
  try {
    await succeeds('postgres', `create database ${database} template template0;`)
    created = true
    await succeeds(database, `create schema auth;
      create table auth.users(id uuid primary key);
      create table public.organizations(id uuid primary key,name text,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
      grant usage on schema auth to authenticated;
      insert into auth.users values('${ownerA}'),('${ownerB}'),('${target}');`)
    // Минимальные auth/organization fixtures проверяют блокировки, не Supabase Auth.
    const migrations = ['20260918010000_add_platform_access_foundation.sql', '20260918020000_manage_platform_assignments.sql', '20260918030000_bootstrap_platform_owner.sql', '20260918040000_confirm_platform_commands.sql', '20260918050000_register_platform_support_cases.sql', '20260918060000_search_platform_organizations.sql', '20260918070000_log_platform_access_denials.sql', '20260918080000_require_platform_command_reasons.sql']
    await succeeds(database, migrations.map(migration => readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')).join('\n'))
    await succeeds(database, `insert into public.platform_access_assignments(id,user_id,role_key,scope_kind) values
      ('${assignmentA}','${ownerA}','owner','platform'),('${assignmentB}','${ownerB}','owner','platform');`)
    const grant = `select public.grant_platform_assignment('${command}','${target}','sales',p_reason_code=>'role_change');`
    const revokeA = `select public.revoke_platform_assignment('${command}','${assignmentA}',p_reason_code=>'role_change');`
    const revokeB = `select public.revoke_platform_assignment('${randomUUID()}','${assignmentB}',p_reason_code=>'role_change');`
    first = sql(database, `set application_name='admin_first'; ${actorClaims(ownerA)} set role authenticated;
      begin; ${operation === 'grant' ? grant : revokeA} select pg_sleep(5); ${ending};`)
    await waitFor(database, 'admin_first', 'PgSleep')
    second = sql(database, `set application_name='admin_second'; ${actorClaims(operation === 'grant' ? ownerA : ownerB)} set role authenticated;
      ${operation === 'grant' ? grant : revokeB}`)
    await waitFor(database, 'admin_second', 'advisory')
    const [one, two] = await Promise.all([first, second])
    expect(one.code, one.error).toBe(0)
    if (operation === 'revoke' && ending === 'commit') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('last platform owner protected')
    } else expect(two.code, two.error).toBe(0)
    if (operation === 'grant') {
      expect(await succeeds(database, `select count(*) from public.platform_access_assignments where user_id='${target}';`)).toBe('1')
      expect(await succeeds(database, `select count(*) from public.platform_assignment_commands where command_id='${command}';`)).toBe('1')
      expect(await succeeds(database, `select count(*) from public.platform_audit_events where command_id='${command}';`)).toBe('1')
    } else {
      expect(await succeeds(database, `select count(*) from public.platform_access_assignments where role_key='owner' and revoked_at is null;`)).toBe('1')
    }
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    // Удаляется только созданная этим тестом БД с непредсказуемым именем.
    if (created && /^qvesta_admin_test_[a-f0-9]{32}$/.test(database)) {
      await succeeds('postgres', `drop database ${database};`)
    }
  }
}, 120000)


test.skipIf(!enabled).each([
  ['bootstrap_same','commit'], ['bootstrap_same','rollback'],
  ['bootstrap_other','commit'], ['bootstrap_other','rollback'],
  ['support_close_first','commit'], ['support_close_first','rollback'],
  ['support_grant_first','commit'], ['support_grant_first','rollback'],
])('bootstrap/поддержка: %s при %s первой транзакции', async (operation, ending) => {
  const database = `qvesta_admin_test_${randomUUID().replaceAll('-', '')}`
  const owner = randomUUID(), target = randomUUID(), organization = randomUUID(), caseId = randomUUID()
  const firstCommand = randomUUID(), secondCommand = randomUUID()
  const bootstrap = operation.startsWith('bootstrap_')
  let created = false, first, second
  try {
    await succeeds('postgres', `create database ${database} template template0;`)
    created = true
    await succeeds(database, `create schema auth;
      create table auth.users(id uuid primary key);
      create table public.organizations(id uuid primary key,name text,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
      grant usage on schema auth to authenticated;
      insert into auth.users values('${owner}'),('${target}');
      insert into public.organizations(id,name) values('${organization}','Синтетическая организация');`)
    const migrations = ['20260918010000_add_platform_access_foundation.sql','20260918020000_manage_platform_assignments.sql','20260918030000_bootstrap_platform_owner.sql','20260918040000_confirm_platform_commands.sql','20260918050000_register_platform_support_cases.sql','20260918060000_search_platform_organizations.sql','20260918070000_log_platform_access_denials.sql','20260918080000_require_platform_command_reasons.sql']
    await succeeds(database, migrations.map(name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url),'utf8')).join('\n'))
    let firstSql, secondSql
    if (bootstrap) {
      firstSql = `select platform_private.bootstrap_owner('${firstCommand}','${owner}');`
      secondSql = operation === 'bootstrap_same' ? firstSql : `select platform_private.bootstrap_owner('${secondCommand}','${target}');`
    } else {
      await succeeds(database, `insert into public.platform_access_assignments(user_id,role_key,scope_kind) values('${owner}','owner','platform');
        insert into public.platform_support_cases(id,organization_id,created_by) values('${caseId}','${organization}','${owner}');`)
      const close = `select public.manage_platform_support_case('${firstCommand}','close','${caseId}',p_reason_code=>'request_resolved');`
      const grant = `select public.grant_platform_support_access('${secondCommand}','${caseId}','${target}',now()+interval '1 hour',p_reason_code=>'support_request');`
      firstSql = operation === 'support_close_first' ? close : grant
      secondSql = operation === 'support_close_first' ? grant : close
    }
    const actor = bootstrap ? '' : `${actorClaims(owner)} set role authenticated;`
    first = sql(database, `set application_name='race_first'; ${actor} begin; ${firstSql} select pg_sleep(5); ${ending};`)
    await waitFor(database,'race_first','PgSleep')
    second = sql(database, `set application_name='race_second'; ${actor} ${secondSql}`)
    await waitFor(database,'race_second','advisory')
    const [one,two] = await Promise.all([first,second])
    expect(one.code,one.error).toBe(0)
    const denied = ending === 'commit' && ['bootstrap_other','support_close_first'].includes(operation)
    if (denied) {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain(bootstrap ? 'platform bootstrap already completed' : 'support case unavailable')
    } else expect(two.code,two.error).toBe(0)
    if (bootstrap) {
      expect(await succeeds(database,"select count(*) from public.platform_access_assignments where role_key='owner';")).toBe('1')
      expect(await succeeds(database,'select count(*) from platform_private.owner_bootstrap;')).toBe('1')
      expect(await succeeds(database,"select count(*) from public.platform_audit_events where action='assignment.created';")).toBe('1')
      const expectedOwner = operation === 'bootstrap_other' && ending === 'rollback' ? target : owner
      expect(await succeeds(database,'select user_id from platform_private.owner_bootstrap;')).toBe(expectedOwner)
    } else {
      const grantExists = (operation === 'support_grant_first' && ending === 'commit') || (operation === 'support_close_first' && ending === 'rollback')
      const closed = !(operation === 'support_close_first' && ending === 'rollback')
      expect(await succeeds(database,"select count(*) from public.platform_access_assignments where role_key='support';")).toBe(grantExists ? '1' : '0')
      expect(await succeeds(database,`select closed_at is not null from public.platform_support_cases where id='${caseId}';`)).toBe(closed ? 't' : 'f')
      expect(await succeeds(database,`select count(*) from public.platform_command_reasons where command_id='${secondCommand}';`)).toBe(grantExists ? '1' : '0')
      const read = await sql(database,`${actorClaims(target)} set role authenticated; select public.get_platform_organization_summary('${organization}');`)
      if (grantExists && !closed) expect(read.code,read.error).toBe(0)
      else { expect(read.code).not.toBe(0); expect(read.error).toContain('platform access denied') }
    }
  } finally {
    await Promise.allSettled([first,second].filter(Boolean))
    if (created && /^qvesta_admin_test_[a-f0-9]{32}$/.test(database)) await succeeds('postgres',`drop database ${database};`)
  }
}, 120000)
