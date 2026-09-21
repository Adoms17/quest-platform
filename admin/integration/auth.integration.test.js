// @vitest-environment node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

const enabled = process.env.RUN_LOCAL_ADMIN_AUTH === '1'
function command(args, env = {}, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, env: { ...process.env, ...env } })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stdin.end(input)
    // Не сохраняем stderr: Auth может включать чувствительные параметры в ошибки.
    if (args[0] === 'logs') child.stderr.on('data', chunk => { output += chunk }); else child.stderr.resume()
    child.on('error', () => reject(new Error('Не удалось запустить Docker')))
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`Ошибка Docker ${args[0]} (code ${code}); содержимое вывода скрыто`)))
  })
}
function totp(secret, milliseconds = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Некорректный формат тестового TOTP')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(milliseconds / 30000)))
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  return ((hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0')
}

// Открытый RFC 6238 вектор; не ключ реального аутентификатора.
test('генератор TOTP: контрольный вектор', () => {
  expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082')
})

test.skipIf(!enabled)('настоящий Auth: TOTP и административные RPC с проверкой подписи JWT', async () => {
  const prefix = `qvesta-auth-test-${randomUUID().replaceAll('-', '')}`
  const network = `${prefix}-net`, database = `${prefix}-db`, auth = `${prefix}-auth`
  const owned = []
  let networkCreated = false
  let failure
  const failures = []
  try {
    await command(['network', 'create', network])
    networkCreated = true
    await command(['run', '-d', '--name', database, '--network', network, '--network-alias', 'test-db', '--tmpfs', '/tmp', '--entrypoint', 'sh', 'supabase/postgres:17.6.1.165', '-c', 'mkdir /tmp/test-pg; chown postgres:postgres /tmp/test-pg; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && echo "host all all all trust" >> /tmp/test-pg/pg_hba.conf && exec gosu postgres postgres -D /tmp/test-pg -c listen_addresses=*'])
    owned.push(database)
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { await command(['exec', database, 'pg_isready', '-U', 'postgres']); ready = true; break } catch { await new Promise(r => setTimeout(r, 500)) }
    }
    if (!ready) throw new Error('Тестовый PostgreSQL не готов')
    await command(['exec', database, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'create schema auth; alter role postgres set search_path=auth,public;'])
    const environment = {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999',
      API_EXTERNAL_URL: 'http://127.0.0.1', GOTRUE_SITE_URL: 'http://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: 'postgres://postgres@test-db:5432/postgres?sslmode=disable',
      GOTRUE_JWT_SECRET: randomBytes(48).toString('hex'), GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_MFA_ENABLED: 'true', GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
      GOTRUE_RATE_LIMIT_EMAIL_SENT: '100', GOTRUE_LOG_LEVEL: 'fatal',
    }
    await command(['run', '-d', '--name', auth, '--network', network, '-p', '127.0.0.1::9999', ...Object.keys(environment).flatMap(key => ['-e', key]), 'supabase/gotrue:v2.196.0'], environment)
    owned.push(auth)
    let binding
    try { binding = await command(['port', auth, '9999/tcp']) } catch {
      const logs = await command(['logs', auth])
      let safe = logs
      for (const value of Object.values(environment)) safe = safe.split(value).join('[test-setting]')
      throw new Error(`Тестовый Auth остановился до публикации порта: ${safe.slice(-1200)}`)
    }
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Небезопасный адрес тестового Auth')
    const base = `http://${binding}`
    ready = false
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* запуск */ }
      await new Promise(r => setTimeout(r, 500))
    }
    if (!ready) throw new Error('Тестовый Auth не готов; логи с чувствительными данными не выводятся')
    async function request(path, body, token) {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
      return { status: response.status, data: await response.json() }
    }
    function successful(result) { expect(result.status).toBeGreaterThanOrEqual(200); expect(result.status).toBeLessThan(300); return result.data }
    function level(token) { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aal }
    const credentials = { email: 'synthetic@example.test', password: randomBytes(24).toString('hex') }
    const signup = successful(await request('/signup', credentials))
    expect(level(signup.access_token)).toBe('aal1')
    const enrolled = successful(await request('/factors', { factor_type: 'totp' }, signup.access_token))
    expect(enrolled.type).toBe('totp')
    const challenge = successful(await request(`/factors/${enrolled.id}/challenge`, {}, signup.access_token))
    const possibleCodes = new Set([-2, -1, 0, 1, 2].map(offset => totp(enrolled.totp.secret, Date.now() + offset * 30000)))
    const invalidCode = Array.from({ length: 10 }, (_, i) => i.toString().padStart(6, '0')).find(code => !possibleCodes.has(code))
    const bad = await request(`/factors/${enrolled.id}/verify`, { challenge_id: challenge.id, code: invalidCode }, signup.access_token)
    expect(bad.status).toBeGreaterThanOrEqual(400)
    const next = successful(await request(`/factors/${enrolled.id}/challenge`, {}, signup.access_token))
    const verified = successful(await request(`/factors/${enrolled.id}/verify`, { challenge_id: next.id, code: totp(enrolled.totp.secret) }, signup.access_token))
    expect(level(verified.access_token)).toBe('aal2')
    const claims = JSON.parse(Buffer.from(verified.access_token.split('.')[1], 'base64url').toString())
    expect(claims.role).toBe('authenticated')
    expect(claims.amr.some(item => item.method === 'totp' && typeof item.timestamp === 'number')).toBe(true)
    const login = successful(await request('/token?grant_type=password', credentials))
    expect(level(login.access_token)).toBe('aal1')
    const profile = successful(await request('/user', null, login.access_token))
    expect(profile.factors.some(item => item.id === enrolled.id && item.status === 'verified')).toBe(true)
    async function sql(source) {
      return command(['exec', '-i', database, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {}, source)
    }
    // Минимальная организация — синтетическая фикстура, миграции admin настоящие.
    await sql(`
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create role authenticator login noinherit;
      grant anon,authenticated to authenticator;
      grant usage on schema public,auth to anon,authenticated;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
      $$;
      create or replace function auth.uid() returns uuid language sql stable as $$
        select (auth.jwt()->>'sub')::uuid;
      $$;
      create table public.organizations(id uuid primary key,name text not null,created_at timestamptz default now());
      alter table public.organizations enable row level security;
      revoke all on public.organizations from public,anon,authenticated;
    `)
    for (const migration of [
      '20260918010000_add_platform_access_foundation.sql',
      '20260918020000_manage_platform_assignments.sql',
      '20260918030000_bootstrap_platform_owner.sql',
      '20260918040000_confirm_platform_commands.sql',
      '20260918050000_register_platform_support_cases.sql',
      '20260918060000_search_platform_organizations.sql',
      '20260918070000_log_platform_access_denials.sql',
      '20260918080000_require_platform_command_reasons.sql',
      '20260915010000_add_billing_plan_versions.sql',
      '20260920060000_add_discount_code_foundation.sql',
      '20260920070000_issue_and_preview_discount_codes.sql',
      '20260920090000_reserve_discount_periods.sql',
      '20260921020000_read_platform_discounts.sql',
      '20260921030000_platform_discount_campaigns.sql',
      '20260921040000_read_discount_campaigns.sql',
      '20260921050000_issue_campaign_discount.sql',
      '20260921060000_global_campaign_catalog.sql',
      '20260921070000_campaign_activation_windows.sql',
    ]) await sql(readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
    const rest = `${prefix}-rest`
    const restEnvironment = {
      PGRST_DB_URI: 'postgres://authenticator@test-db:5432/postgres',
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: environment.GOTRUE_JWT_SECRET,
    }
    await command(['run', '-d', '--name', rest, '--network', network, '-p', '127.0.0.1::3000', ...Object.keys(restEnvironment).flatMap(key => ['-e', key]), 'public.ecr.aws/supabase/postgrest:v16.1'], restEnvironment)
    owned.push(rest)
    const restBinding = await command(['port', rest, '3000/tcp'])
    if (!/^127\.0\.0\.1:\d+$/.test(restBinding)) throw new Error('Небезопасный адрес тестового API')
    const restBase = `http://${restBinding}`
    ready = false
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(restBase, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* запуск */ }
      await new Promise(r => setTimeout(r, 250))
    }
    if (!ready) throw new Error('Тестовый PostgREST не готов')
    async function rpc(name, body, token = verified.access_token) {
      const response = await fetch(`${restBase}/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      return { status: response.status, data: await response.json() }
    }
    { const denied = await rpc('search_platform_organizations', {}); expect({ status: denied.status, code: denied.data.code }).toEqual({ status: 403, code: '42501' }) }
    expect((await rpc('search_platform_organizations', {}, null)).status).toBe(401)
    expect((await rpc('grant_platform_assignment', { p_command_id: randomUUID(), p_user_id: signup.user.id, p_role: 'owner', p_reason_code: 'role_change' })).status).toBe(403)
    const actor = signup.user.id
    if (!/^[0-9a-f-]{36}$/.test(actor)) throw new Error('Некорректный ID синтетического аккаунта')
    const org = randomUUID()
    await sql(`insert into public.organizations(id,name) values('${org}','Синтетическая организация');`)
    const assignment = await sql(`select platform_private.bootstrap_owner('${randomUUID()}','${actor}');`)
    expect((await rpc('search_platform_organizations', {}, login.access_token)).status).toBe(403)
    const page = successful(await rpc('search_platform_organizations', {}))
    expect(page.items.map(item => item.id)).toEqual([org])
    const card = successful(await rpc('get_platform_organization_summary', { p_organization_id: org }))
    expect(Object.keys(card).sort()).toEqual(['created_at', 'id', 'name'])
    // Реальные миграции и RPC; checkout и переходы подписок проверяются отдельно.
    const campaign = randomUUID()
    const saveCampaign = {
      p_command_id: randomUUID(), p_id: campaign, p_organization_id: null,
      p_expected_revision: 0, p_title: 'Auth integration campaign', p_plan_key: 'pro',
      p_discount_bps: 2500, p_eligible_periods: 2, p_period_months: 1,
      p_starts_at: new Date(Date.now() - 60000).toISOString(),
      p_activate_before: new Date(Date.now() + 86400000 * 7).toISOString(),
    }
    const campaignQuery = { p_organization_id: null, p_id: campaign }
    const approveCampaign = { p_command_id: randomUUID(), p_id: campaign, p_expected_revision: 1 }
    const issueCampaign = {
      p_organization_id: org, p_campaign_id: campaign, p_expected_revision: 1,
      p_command_id: randomUUID(), p_activate_before: new Date(Date.now() + 86400000).toISOString(),
    }
    for (const [name, body] of [
      ['save_platform_discount_campaign', saveCampaign],
      ['approve_platform_discount_campaign', approveCampaign],
      ['issue_platform_campaign_discount', issueCampaign],
      ['read_platform_discount_campaigns', campaignQuery],
    ]) {
      expect((await rpc(name, body, login.access_token)).status, name + ' requires MFA').toBe(403)
      expect((await rpc(name, body, null)).status, name + ' rejects anonymous').toBe(401)
    }
    expect(successful(await rpc('save_platform_discount_campaign', saveCampaign))).toMatchObject({ id: campaign, revision: 1, state: 'draft', organization_id: null })
    expect(successful(await rpc('save_platform_discount_campaign', saveCampaign))).toMatchObject({ id: campaign, revision: 1 })
    expect((await rpc('issue_platform_campaign_discount', issueCampaign)).data.code).toBe('55000')
    expect((await rpc('save_platform_discount_campaign', { ...saveCampaign, p_command_id: randomUUID() })).data.code).toBe('40001')
    expect(successful(await rpc('approve_platform_discount_campaign', approveCampaign))).toMatchObject({ state: 'approved' })
    const issued = successful(await rpc('issue_platform_campaign_discount', issueCampaign))
    expect(issued.already_issued).toBe(false)
    expect(typeof issued.code === 'string' && /^[A-F0-9]{32}$/.test(issued.code)).toBe(true)
    expect(successful(await rpc('issue_platform_campaign_discount', issueCampaign))).toEqual({ discount_id: issued.discount_id, already_issued: true, code: null })
    expect(successful(await rpc('read_platform_discount_campaigns', campaignQuery)).items).toMatchObject([{ id: campaign, has_issued_codes: true }])
    expect((await rpc('save_platform_discount_campaign', { ...saveCampaign, p_command_id: randomUUID(), p_expected_revision: 1 })).data.code).toBe('55000')
    const stored = JSON.parse(await sql(`select jsonb_build_object('count',count(*),'hashed',bool_and(code_hash ~ '^[0-9a-f]{64}$'),'deadline',min(activate_before)) from public.billing_discount_codes where campaign_id='${campaign}';`))
    expect(stored.count).toBe(1)
    expect(stored.hashed).toBe(true)
    expect(new Date(stored.deadline).toISOString()).toBe(issueCampaign.p_activate_before)
    const parts = verified.access_token.split('.')
    parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString('base64url')
    expect((await rpc('search_platform_organizations', {}, parts.join('.'))).status).toBe(401)
    if (process.env.RUN_LOCAL_ADMIN_BROWSER === '1') {
      const { verifyRealAdminBrowser } = await import('./browserFlow.mjs')
      await verifyRealAdminBrowser({ authBase: base, restBase, credentials, nextCode: async () => {
        // Ждём новый 30-секундный интервал, не повторяя уже использованный TOTP.
        await new Promise(resolve => setTimeout(resolve, 31000 - Date.now() % 30000))
        return totp(enrolled.totp.secret)
      } })
    }
    // Отдельный настоящий аккаунт продаж: сначала платформа, затем одна организация.
    const salesCredentials = { email: 'sales@example.test', password: randomBytes(24).toString('hex') }
    const sales = successful(await request('/signup', salesCredentials))
    const salesFactor = successful(await request('/factors', { factor_type: 'totp' }, sales.access_token))
    const salesChallenge = successful(await request(`/factors/${salesFactor.id}/challenge`, {}, sales.access_token))
    const salesMfa = successful(await request(`/factors/${salesFactor.id}/verify`, { challenge_id: salesChallenge.id, code: totp(salesFactor.totp.secret) }, sales.access_token))
    expect(level(salesMfa.access_token)).toBe('aal2')
    const grantSales = organizationId => rpc('grant_platform_assignment', {
      p_command_id: randomUUID(), p_user_id: sales.user.id, p_role: 'sales',
      p_organization_id: organizationId, p_reason_code: 'role_change',
    })
    const globalSales = successful(await grantSales(null))
    const salesDraft = { ...saveCampaign, p_command_id: randomUUID(), p_id: randomUUID() }
    expect((await rpc('save_platform_discount_campaign', salesDraft, sales.access_token)).status).toBe(403)
    expect(successful(await rpc('save_platform_discount_campaign', salesDraft, salesMfa.access_token))).toMatchObject({ id: salesDraft.p_id, state: 'draft' })
    expect(successful(await rpc('read_platform_discount_campaigns', { p_organization_id: null, p_id: salesDraft.p_id }, salesMfa.access_token)).items).toMatchObject([{ id: salesDraft.p_id }])
    const salesApproval = { p_command_id: randomUUID(), p_id: salesDraft.p_id, p_expected_revision: 1 }
    expect((await rpc('approve_platform_discount_campaign', salesApproval, salesMfa.access_token)).status).toBe(403)
    successful(await rpc('approve_platform_discount_campaign', salesApproval))
    successful(await rpc('revoke_platform_assignment', { p_command_id: randomUUID(), p_assignment_id: globalSales, p_reason_code: 'role_change' }))
    const scopedSales = successful(await grantSales(org))
    const otherOrg = randomUUID()
    await sql(`insert into public.organizations(id,name) values('${otherOrg}','Other synthetic organization');`)
    const scopedQuery = { p_organization_id: org, p_id: salesDraft.p_id }
    expect(successful(await rpc('read_platform_discount_campaigns', scopedQuery, salesMfa.access_token)).items).toMatchObject([{ id: salesDraft.p_id }])
    expect((await rpc('read_platform_discount_campaigns', { ...scopedQuery, p_organization_id: otherOrg }, salesMfa.access_token)).status).toBe(403)
    expect((await rpc('read_platform_discount_campaigns', { p_organization_id: null }, salesMfa.access_token)).status).toBe(403)
    expect((await rpc('save_platform_discount_campaign', { ...salesDraft, p_command_id: randomUUID(), p_expected_revision: 1 }, salesMfa.access_token)).status).toBe(403)
    const salesIssue = { ...issueCampaign, p_campaign_id: salesDraft.p_id, p_command_id: randomUUID() }
    expect((await rpc('issue_platform_campaign_discount', salesIssue, sales.access_token)).status).toBe(403)
    expect((await rpc('issue_platform_campaign_discount', { ...salesIssue, p_organization_id: otherOrg }, salesMfa.access_token)).status).toBe(403)
    const salesCode = successful(await rpc('issue_platform_campaign_discount', salesIssue, salesMfa.access_token))
    expect(salesCode.already_issued).toBe(false)
    expect(typeof salesCode.code === 'string' && /^[A-F0-9]{32}$/.test(salesCode.code)).toBe(true)
    expect(successful(await rpc('issue_platform_campaign_discount', salesIssue, salesMfa.access_token))).toEqual({ discount_id: salesCode.discount_id, already_issued: true, code: null })
    successful(await rpc('revoke_platform_assignment', { p_command_id: randomUUID(), p_assignment_id: scopedSales, p_reason_code: 'role_change' }))
    expect((await rpc('read_platform_discount_campaigns', scopedQuery, salesMfa.access_token)).status).toBe(403)
    expect((await rpc('issue_platform_campaign_discount', salesIssue, salesMfa.access_token)).status).toBe(403)
    expect(await sql(`select count(*) from public.billing_discount_codes where campaign_id='${salesDraft.p_id}';`)).toBe('1')
    const second = successful(await request('/signup', { email: 'second@example.test', password: randomBytes(24).toString('hex') }))
    // Настоящий AMR totp допускает чувствительную команду с окном свежести.
    successful(await rpc('grant_platform_assignment', { p_command_id: randomUUID(), p_user_id: second.user.id, p_role: 'owner', p_reason_code: 'role_change' }))
    successful(await rpc('revoke_platform_assignment', { p_command_id: randomUUID(), p_assignment_id: assignment, p_reason_code: 'role_change' }))
    { const denied = await rpc('search_platform_organizations', {}); expect({ status: denied.status, code: denied.data.code }).toEqual({ status: 403, code: '42501' }) }
    expect((await rpc('read_platform_discount_campaigns', campaignQuery)).status).toBe(403)
    expect((await rpc('issue_platform_campaign_discount', issueCampaign)).status).toBe(403)
    expect((await rpc('save_platform_discount_campaign', saveCampaign)).status).toBe(403)
    expect((await sql("select count(*) from public.platform_audit_events where action='assignment.revoke';")).trim()).toBe('3')
    // Отказы уже завершились rollback, но структурированные события остались в журнале БД.
    const databaseLogs = await command(['logs', database])
    const events = databaseLogs.split('\n').filter(line => line.includes('QVESTA_ADMIN_DENIAL '))
      .map(line => JSON.parse(line.slice(line.indexOf('QVESTA_ADMIN_DENIAL ') + 'QVESTA_ADMIN_DENIAL '.length)))
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events.some(event => event.action === 'assignment.grant')).toBe(true)
    expect(events.filter(event => event.action === 'organization.search').length).toBeGreaterThanOrEqual(3)
    expect(new Set(events.map(event => event.event_id)).size).toBe(events.length)
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['action','actor_id','event_id','occurred_at','sqlstate','version'])
      expect([actor, sales.user.id]).toContain(event.actor_id)
      expect(event.sqlstate).toBe('42501')
    }
    expect(JSON.stringify(events).includes(verified.access_token)).toBe(false)
    expect(JSON.stringify(events).includes(credentials.password)).toBe(false)
    expect(JSON.stringify(events).includes(salesMfa.access_token)).toBe(false)
    expect(JSON.stringify(events).includes(salesCredentials.password)).toBe(false)
    expect((await sql("select has_function_privilege('authenticated','platform_private.search_platform_organizations(text,uuid,integer)','execute');")).trim()).toBe('f')
  } catch (error) {
    failure = error
  } finally {
    for (const name of owned.reverse()) {
      try { await command(['rm', '-f', '-v', name]) } catch { failures.push(name) }
    }
    if (networkCreated) { try { await command(['network', 'rm', network]) } catch { failures.push(network) } }
  }
  if (failures.length) throw new AggregateError([...(failure ? [failure] : []), new Error('Остались тестовые ресурсы: ' + failures.join(', '))], 'Ошибка очистки тестового стенда')
  if (failure) throw failure
}, 180000)
