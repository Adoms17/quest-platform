// @vitest-environment node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

const enabled = process.env.RUN_LOCAL_QUOTA_E2E === '1'
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output, error }))
    child.stdin.end(`set statement_timeout='15s';\n${query}`)
  })
}
async function waitFor(name, predicate) {
  for (let i = 0; i < 40; i++) {
    const result = await sql(`select count(*) from pg_stat_activity where application_name='${name}' and ${predicate};`)
    expect(result.code, result.error).toBe(0)
    if (result.output.trim().endsWith('1')) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Не наблюдалась ожидаемая серверная блокировка')
}

test.skipIf(!enabled).each(['register-commit', 'register-rollback', 'archive-retry', 'archive-register'])('конфликт двух устройств: %s', async mode => {
  const owner = randomUUID(), quest = randomUUID(), event = randomUUID()
  const org = `(select id from public.organizations where personal_owner_id='${owner}')`
  const actor = `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`
  let permitId
  const register = local => `select public.register_permitted_offline_attempt('${quest}','${owner}','${local}','${permitId}');`
  const archive = () => `select public.preserve_conflicting_offline_events('${quest}','${owner}','second',jsonb_build_array(jsonb_build_object('clientEventId','${event}','eventType','finish')),'${permitId}');`
  const receipt = result => JSON.parse(result.output.split(/\r?\n/).find(line => line.startsWith('{')))
  let first, second
  try {
    const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
      update public.organization_subscriptions set status='free',plan_version_id=(select id from public.billing_plan_versions where plan_key='free' and version=1) where organization_id=${org};
      insert into public.quests(id,creator_id,organization_id,title,is_open,is_public) values('${quest}','${owner}',${org},'Concurrent permit test',true,true);
      ${actor} select public.prepare_offline_start_permit('${quest}','${owner}','${randomUUID()}');`)
    expect(setup.code, setup.error).toBe(0)
    permitId = receipt(setup).id
    expect(permitId).toMatch(/^[0-9a-f-]{36}$/)
    if (mode.startsWith('archive')) {
      const registered = await sql(`${actor} ${register('first')}`)
      expect(registered.code, registered.error).toBe(0)
    }
    first = sql(`set application_name='conflict_first_${owner}'; begin; ${actor} ${mode.startsWith('archive') ? archive() : register('first')}
      select pg_sleep(4); ${mode === 'register-rollback' ? 'rollback' : 'commit'};`)
    await waitFor(`conflict_first_${owner}`, "wait_event='PgSleep'")
    second = sql(`set application_name='conflict_second_${owner}'; ${actor} ${mode === 'archive-register' ? register('second') : archive()}`)
    await waitFor(`conflict_second_${owner}`, "wait_event_type='Lock'")
    const [one, two] = await Promise.all([first, second])
    expect(one.code, one.error).toBe(0)
    if (mode === 'register-rollback') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('offline permit conflict not established')
      const recovered = await sql(`${actor} ${register('second')}`)
      expect(recovered.code, recovered.error).toBe(0)
    } else if (mode === 'archive-register') {
      expect(two.code).not.toBe(0)
      expect(two.error).toContain('offline permit conflict requires review')
    } else {
      expect(two.code, two.error).toBe(0)
      expect(receipt(two).state).toBe('needs_review')
      if (mode === 'archive-retry') expect(receipt(two)).toEqual(receipt(one))
    }
    if (mode !== 'register-rollback') {
      const retry = await sql(`${actor} ${archive()}`)
      expect(retry.code, retry.error).toBe(0)
      expect(receipt(retry).receipts).toHaveLength(1)
    }
    const counts = await sql(`select count(*) from public.quest_attempts where quest_id='${quest}' and finished_at is null;
      select count(*) from public.offline_attempt_registrations where quest_id='${quest}';
      select count(*) from public.offline_event_reviews where quest_id='${quest}' and review_reason='permit_conflict';`)
    expect(counts.code, counts.error).toBe(0)
    expect(counts.output.trim().split(/\r?\n/).slice(-3)).toEqual(['1', '1', mode === 'register-rollback' ? '0' : '1'])
  } finally {
    await Promise.allSettled([first, second].filter(Boolean))
    // Удаляются только созданные этим тестом записи со случайными UUID.
    const cleanup = await sql(`delete from public.offline_event_reviews where quest_id='${quest}';
      delete from public.offline_attempt_registrations where quest_id='${quest}';
      delete from public.offline_start_permit_requests where quest_id='${quest}';
      delete from public.offline_start_permits where quest_id='${quest}';
      delete from public.quest_attempts where quest_id='${quest}'; delete from public.quests where id='${quest}';
      delete from public.organizations where personal_owner_id='${owner}';
      delete from public.participant_profiles where created_by_user_id='${owner}';
      delete from public.profiles where id='${owner}'; delete from auth.users where id='${owner}';`)
    expect(cleanup.code, cleanup.error).toBe(0)
  }
}, 60000)
