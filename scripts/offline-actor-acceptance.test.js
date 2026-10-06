// @vitest-environment node
import { test, expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer as createViteServer } from 'vite'
import { removeOwnedResource, runAcceptanceCleanup } from './offline-acceptance-cleanup.js'
import { verifyAccountActivity } from './verify-account-activity.js'

const enabled = process.env.RUN_ISOLATED_OFFLINE_ACCEPTANCE === '1'
const root = fileURLToPath(new URL('../', import.meta.url))

test.skipIf(!enabled)('isolated real Auth/RLS/offline acceptance', async () => {
  const owner = `qvesta-offline-${randomUUID().replaceAll('-', '')}`
  const directory = `${root}/.review.local`
  const configDirectory = `${directory}/docker-client`
  mkdirSync(configDirectory, { recursive: true })
  const secret = randomBytes(48).toString('hex')
  const containers = []
  let network, proxy, vite, primaryError
  const evidence = { owner, startedAtUtc: new Date().toISOString(), backend: 'fresh PostgreSQL + GoTrue + PostgREST; real repository migrations', checks: [], cleanup: [] }
  function docker(args, input, environment = {}) {
    const result = spawnSync('docker', ['--config', configDirectory, ...args], {
      cwd: root, windowsHide: true, encoding: 'utf8', input,
      env: { ...process.env, ...environment }, timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    })
    if (result.status !== 0) {
      // Never publish Docker environment or Auth diagnostics.
      const diagnostic = args[0] === 'exec' ? String(result.stderr || '').replaceAll(secret, '[ephemeral]').slice(-1200) : ''
      throw new Error(`Isolated Docker ${args[0]} failed. ${diagnostic}`)
    }
    return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim()
  }
  function inspect(id) {
    const info = JSON.parse(docker(['inspect', id]))[0]
    if (info.Id !== id || info.Config.Labels?.['qvesta.test.owner'] !== owner) throw new Error('Container ownership mismatch')
    return info
  }
  function create(name, image, args, environment = {}, command = []) {
    const id = docker(['create', '--pull', 'never', '--name', `${owner}-${name}`, '--label', `qvesta.test.owner=${owner}`,
      '--network', network, ...args, ...Object.keys(environment).flatMap(key => ['-e', key]), image, ...command], undefined, environment)
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Missing container ID')
    containers.push(id)
    writeFileSync(`${directory}/offline-auth-resources.json`, JSON.stringify({ owner, network, containers }, null, 2))
    const info = inspect(id), host = info.HostConfig
    if (host.NetworkMode !== network || host.Privileged || host.Binds?.length || host.Mounts?.length || host.VolumesFrom?.length ||
      Object.values(host.PortBindings || {}).flat().some(binding => binding.HostIp !== '127.0.0.1')) throw new Error('Isolation preflight failed')
    docker(['start', id])
    return id
  }
  async function ready(check, label) {
    for (let i = 0; i < 80; i++) {
      try { if (await check()) return } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`${label} startup failed; sensitive logs suppressed`)
  }
  const binding = (id, port) => {
    let value
    try { value = docker(['port', id, `${port}/tcp`]) } catch {
      const info = inspect(id)
      const lines = docker(['logs', '--tail', '12', id]).split('\n').flatMap(line => {
        try { const row = JSON.parse(line); return row.level === 'fatal' || row.level === 'error' ? [String(row.error || row.msg)] : [] } catch { return [] }
      }).join('; ').replaceAll(secret, '[ephemeral]').replace(/postgres:\/\/[^\s]+/g, '[isolated database]')
      throw new Error(`Isolated port unavailable: state=${info.State.Status}, exit=${info.State.ExitCode}, bindings=${JSON.stringify(info.NetworkSettings.Ports)}, diagnostics=${lines}`)
    }
    if (!/^127\.0\.0\.1:\d+$/.test(value)) throw new Error('Non-loopback port')
    return `http://${value}`
  }
  try {
    // Docker Desktop does not publish loopback ports on an internal-only bridge.
    // A dedicated bridge contains only this run's containers; every published port is loopback.
    network = docker(['network', 'create', '--driver', 'bridge', '--label', `qvesta.test.owner=${owner}`, `${owner}-net`])
    const net = JSON.parse(docker(['network', 'inspect', network]))[0]
    expect(net.Labels['qvesta.test.owner']).toBe(owner)
    expect(Object.keys(net.Containers || {})).toHaveLength(0)
    const databaseId = create('db', 'supabase/postgres:17.6.1.165', [
      '--network-alias', 'test-db', '--tmpfs', '/tmp', '--entrypoint', 'sh',
    ], {}, ['-c', 'mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && echo "host all all all trust" >> /tmp/test-pg/pg_hba.conf && exec gosu postgres postgres -D /tmp/test-pg -c listen_addresses=* -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres'])
    await ready(() => docker(['exec', databaseId, 'pg_isready', '-U', 'postgres']).includes('accepting'), 'Postgres')
    const sql = source => docker(['exec', '-i', databaseId, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], source)
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator login noinherit;
      create role dashboard_user; create role supabase_read_only_user;
      grant anon,authenticated,service_role to authenticator with inherit false;
      revoke all on schema public from public;
      grant usage on schema public to anon,authenticated; grant usage,create on schema public to service_role;
      create schema auth; alter role postgres set search_path=auth,public;`)
    const auth = create('auth', 'supabase/gotrue:v2.196.0', ['-p', '127.0.0.1::9999'], {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://127.0.0.1:9999', GOTRUE_SITE_URL: 'http://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: 'postgres://postgres@test-db:5432/postgres?sslmode=disable&search_path=auth',
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UP: '1000', GOTRUE_LOG_LEVEL: 'fatal',
    })
    const authUrl = binding(auth, 9999)
    await ready(async () => (await fetch(`${authUrl}/health`, {signal: AbortSignal.timeout(1000)})).ok, 'GoTrue')
    sql(`alter role postgres reset search_path; grant usage on schema auth to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`)
    const migrationDirectory = new URL('../supabase/migrations/', import.meta.url)
    const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()
    const identityMigration = '20261006010000_participant_profile_identity.sql'
    const historical = migrations.filter(name => name < identityMigration)
    expect(historical).toHaveLength(324)
    sql(historical.map(name => readFileSync(new URL(name, migrationDirectory), 'utf8')).join('\n'))
    // Profile identity depends on the real Storage schema, supplied by Storage
    // migrations, before the two new application migrations are replayed in order.
    create('storage', 'supabase/storage-api:v1.70.3', ['--tmpfs', '/var/lib/storage:mode=1777'], {
      DATABASE_URL: 'postgres://postgres@test-db:5432/postgres?sslmode=disable', AUTH_JWT_SECRET: secret,
      STORAGE_BACKEND: 'file', FILE_STORAGE_BACKEND_PATH: '/var/lib/storage', TENANT_ID: owner, REGION: 'local',
      FILE_SIZE_LIMIT: '1048576', DB_INSTALL_ROLES: 'true', DB_MIGRATIONS_STRATEGY: 'on_start', LOG_LEVEL: 'fatal', S3_PROTOCOL_ENABLED: 'false',
    })
    await ready(() => sql("select to_regclass('storage.objects') is not null") === 't', 'Storage schema')
    sql(migrations.filter(name => name >= identityMigration).map(name => readFileSync(new URL(name, migrationDirectory), 'utf8')).join('\n'))
    sql('create extension if not exists pgtap with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;')
    for (const suite of ['participant_identity', 'participant_avatar_cleanup_race', 'participant_profile_card', 'group_member_catalog', 'group_exit_actions']) {
      const tap = sql('set search_path=public,extensions;\n' + readFileSync(new URL(`../supabase/tests/database/${suite}.test.sql`, import.meta.url), 'utf8'))
      expect(tap, suite).not.toMatch(/not ok|Looks like|Bail out!/)
      expect(tap, suite).toMatch(/1\.\.\d+/)
      evidence.checks.push({name: suite, result: 'PASS', assertions: Number(tap.match(/1\.\.(\d+)/)[1])})
    }
    await verifyAccountActivity({sql, databaseId, dockerArgs: ['--config', configDirectory]})
    evidence.checks.push({name: 'account activity SQL/RLS and concurrent writes', result: 'PASS'})
    expect(sql('select count(*) from cron.job where active')).toBe('0')
    evidence.checks.push({ name: 'migration replay', result: 'PASS', count: migrations.length })
    console.log(`Isolated real Auth ready; ${migrations.length} migrations applied; no active cron jobs.`)
    const rest = create('rest', 'postgrest/postgrest:v16.1', ['-p', '127.0.0.1::3000'], {
      PGRST_DB_URI: 'postgres://authenticator@test-db:5432/postgres', PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret, PGRST_JWT_AUD: 'authenticated', PGRST_SERVER_PORT: '3000',
    })
    const restUrl = binding(rest, 3000)
    await ready(async () => (await fetch(restUrl, {signal: AbortSignal.timeout(1000)})).ok, 'PostgREST')
    const body = [Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({role: 'anon', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')].join('.')
    const anon = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
    proxy = createHttpServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || 'authorization, apikey, content-type, accept-profile, content-profile, x-client-info, prefer, range, x-supabase-api-version')
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
      const target = request.url.startsWith('/auth/v1/') ? authUrl + request.url.slice('/auth/v1'.length)
        : request.url.startsWith('/rest/v1/') ? restUrl + request.url.slice('/rest/v1'.length) : null
      if (!target) { response.writeHead(404).end(); return }
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const headers = {...request.headers}; delete headers.host; delete headers['content-length']; delete headers['accept-encoding']
        const upstream = await fetch(target, {method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined})
        response.statusCode = upstream.status
        for (const [key, value] of upstream.headers) if (!['content-length','content-encoding','transfer-encoding','access-control-allow-origin'].includes(key)) response.setHeader(key, value)
        response.end(Buffer.from(await upstream.arrayBuffer()))
      } catch { response.writeHead(502).end() }
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const backend = `http://127.0.0.1:${proxy.address().port}`
    vite = await createViteServer({ root, envDir: false, configFile: `${root}/vite.config.js`, cacheDir: `${directory}/real-vite-cache`,
      define: {'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(backend), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anon)},
      server: {host: '127.0.0.1', port: 0},
      plugins: [{name: 'isolated-acceptance-page', configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__offline-acceptance__') return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/e2e/fixtures/offline-real-backend.jsx"></script>'))
        })
      }}],
    })
    await vite.listen()
    const frontend = `http://127.0.0.1:${vite.httpServer.address().port}`
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'test', '--config', 'playwright.offline-real.config.js'], {cwd: root, windowsHide: true,
        env: {...process.env, RUN_ISOLATED_OFFLINE_ACCEPTANCE: '1', RUN_LOCAL_SUPABASE_E2E: '1', OFFLINE_ACCEPTANCE_URL: frontend}, stdio: ['ignore', 'pipe', 'pipe']})
      child.stdout.on('data', chunk => process.stdout.write(chunk))
      child.stderr.on('data', chunk => process.stderr.write(chunk))
      child.on('error', reject); child.on('close', resolve)
    })
    evidence.checks.push({name: 'real browser acceptance', result: result === 0 ? 'PASS' : 'FAIL'})
    expect(result).toBe(0)
  } catch (error) { primaryError = error }
  // Async subprocess timeouts keep cleanup timers live even when Docker hangs.
  const cleanupDocker = args => new Promise((resolve, reject) => {
    const child = spawn('docker', ['--config', configDirectory, ...args], {cwd: root, windowsHide: true, timeout: 20000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore']})
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error('Cleanup Docker command failed')))
  })
  await runAcceptanceCleanup({primaryError, evidence,
    writeReceipt: receipt => writeFile(`${directory}/offline-auth-evidence.json`, JSON.stringify(receipt, null, 2)),
    steps: [
      {name: 'vite', run: () => vite?.close()},
      {name: 'proxy-connections', run: () => proxy?.closeAllConnections()},
      {name: 'proxy', run: () => proxy && new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()))},
      ...[...containers].reverse().map(id => ({name: id, timeoutMs: 45000, run: () => removeOwnedResource(cleanupDocker, owner, id)})),
      ...(network ? [{name: network, timeoutMs: 45000, run: () => removeOwnedResource(cleanupDocker, owner, network, true)}] : []),
    ],
  })
}, 480000)
