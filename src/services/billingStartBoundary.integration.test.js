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

test.skipIf(!enabled).each(['boundary', 'renewal', 'rollback'])(
  'новый старт на границе grace: %s', async mode => {
    const owner = randomUUID(), confirmation = randomUUID(), renewal = randomUUID(), member = randomUUID(), quest = randomUUID()
    const org = `(select id from public.organizations where personal_owner_id='${owner}')`
    const action = `select set_config('request.jwt.claim.sub','${owner}',false); select public.start_quest_attempt_for_participant('${quest}','${owner}');`
    const read = `set role service_role; select public.lock_organization_billing_policy(${org});`
    let first, second
    try {
      // Исторический период — только синтетическая фикстура администратора БД.
      // Реальный RPC не принимает уже истёкший период как новую оплату.
      const setup = await sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
        update public.organization_subscriptions set status='active',quest_start_enforcement_enabled=true,
          plan_version_id=(select id from public.billing_plan_versions where plan_key='pro' and version=1),
          period_start=clock_timestamp()-interval '30 days',
          period_end=clock_timestamp()-interval '120 hours'+interval '4 seconds'
        where organization_id=${org};
        insert into public.billing_period_confirmations(confirmation_id,organization_id,request,before_state,result)
          select '${confirmation}',organization_id,
            jsonb_build_object('plan',plan_version_id,'start',period_start,'end',period_end,'revision',0),
            '{}'::jsonb,jsonb_build_object('revision',revision)
          from public.organization_subscriptions where organization_id=${org};
        insert into auth.users(id,email) values('${member}','${member}@example.test');
        insert into public.quests(id,creator_id,organization_id,title,is_open,is_public) values('${quest}','${owner}',${org},'Boundary test',true,true);
        insert into public.organization_memberships(organization_id,user_id,status) values(${org},'${member}','invited');
        select public.lock_organization_billing_policy(${org});`)
      expect(setup.code, setup.error).toBe(0)
      const receipt = result => JSON.parse(result.output.split(/\r?\n/).find(line => line.startsWith('{')))
      const initial = receipt(setup)
      expect(initial.phase).toBe('grace')
      const change = `set role service_role; select public.confirm_organization_subscription_period(
        ${org},'${renewal}',1,
        (select plan_version_id from public.organization_subscriptions where organization_id=${org}),
        (select period_start from public.organization_subscriptions where organization_id=${org}),
        clock_timestamp()+interval '30 days');`
      first = sql(`set application_name='grace_first_${owner}'; begin;
        ${mode === 'boundary' ? read : change}
        select pg_sleep(6); ${mode === 'rollback' ? 'rollback' : 'commit'};`)
      let holding = false
      for (let i = 0; i < 20; i++) {
        const state = await sql(`select count(*) from pg_stat_activity
          where application_name='grace_first_${owner}' and wait_event='PgSleep';`)
        if (state.output.trim().endsWith('1')) { holding = true; break }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(holding).toBe(true)
      second = sql(`set application_name='grace_second_${owner}'; set role service_role; ${action}`)
      let blocked = false
      for (let i = 0; i < 20; i++) {
        const state = await sql(`select count(*) from pg_stat_activity
          where application_name='grace_second_${owner}' and wait_event_type='Lock'
            and query_start < '${initial.grace_end}'::timestamptz;`)
        if (state.output.trim().endsWith('1')) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(blocked, 'запрос ожидает блокировку до окончания grace').toBe(true)
      const [one, two] = await Promise.all([first, second])
      expect(one.code, one.error).toBe(0)
      if (mode === 'renewal') expect(two.code, two.error).toBe(0)
      else {
        expect(two.code).not.toBe(0)
        expect(two.error).toContain('quest start billing unavailable')
      }
      const fresh = await sql(read)
      expect(fresh.code, fresh.error).toBe(0)
      const result = receipt(fresh)
      expect(new Date(result.measured_at).getTime()).toBeGreaterThanOrEqual(new Date(initial.grace_end).getTime())
      expect(result.phase).toBe(mode === 'renewal' ? 'active' : 'expired')
      expect(result.billing_allows_resource_increase).toBe(mode === 'renewal')
      expect(result.confirmation_id).toBe(mode === 'renewal' ? renewal : confirmation)
      expect(result.subscription_revision).toBe(mode === 'renewal' ? 2 : 1)
      const usage = await sql(`select (count(*)=1)::text from public.quest_attempts where quest_id='${quest}';`)
      expect(usage.code, usage.error).toBe(0)
      expect(usage.output.trim().endsWith(mode === 'renewal' ? 'true' : 'false')).toBe(true)
      const retry = await sql(read)
      expect(retry.code, retry.error).toBe(0)
      expect(receipt(retry).phase).toBe(result.phase)
    } finally {
      await Promise.allSettled([first, second].filter(Boolean))
      const cleanup = await sql(`delete from public.quests where id='${quest}';
        delete from public.organizations where personal_owner_id in ('${owner}','${member}');
        delete from public.participant_profiles where created_by_user_id in ('${owner}','${member}');
        delete from public.profiles where id in ('${owner}','${member}'); delete from auth.users where id in ('${owner}','${member}');`)
      expect(cleanup.code, cleanup.error).toBe(0)
    }
  }, 60000)
