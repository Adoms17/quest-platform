// Opt-in disposable test infrastructure only. Never connects to a shared Supabase.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { loadShopFixturePlan } from './shop-fixture-loader.js'
import { removeOwnedResource } from './offline-acceptance-cleanup.js'

export async function withShopBackend(run, { stagePrerequisitesOnly = false } = {}) {
  if (typeof stagePrerequisitesOnly !== 'boolean') throw new Error('Invalid disposable migration mode')
  const root = resolve('.')
  if (stagePrerequisitesOnly) throw Error('Prerequisites-only mode is outside this pinned fixture suite')
  const fixturePlan = loadShopFixturePlan(root)
  const owner = `qvesta-shop-${randomUUID().replaceAll('-', '')}`
  const directory = resolve('docs/qa/shop04-integration', owner)
  const config = resolve(directory, 'docker-client')
  mkdirSync(config, { recursive: true })
  const dockerArgs = ['--config', config, ...(process.env.SHOP_TEST_DOCKER_HOST ? ['--host', process.env.SHOP_TEST_DOCKER_HOST] : [])]
  const secret = randomBytes(48).toString('hex')
  const containers = []
  const sqlChildren = new Set()
  const evidence = { owner, startedAt: new Date().toISOString(), checks: [], created: [], cleanup: [] }
  let network, proxy, failure, resourceCreationAttempted = false
  // Write IDs immediately after creation so an interrupted run can be recovered
  // without discovering or deleting another session's resources.
  const saveResources = () => writeFileSync(resolve(directory, 'resources.json'), JSON.stringify({ owner, network, containers }, null, 2))
  saveResources()
  const docker = (args, input, environment = {}) => {
    const result = spawnSync('docker', [...dockerArgs, ...args], {
      cwd: root, windowsHide: true, encoding: 'utf8', input, timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...environment },
    })
    // Do not print arguments/environment/Auth diagnostics (contain ephemeral credentials).
    if (result.status !== 0) {
      const sqlState = args.includes('psql') ? result.stderr?.match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1] : null
      throw new Error(`Owned shop Docker ${args[0]} failed (${result.error?.code || result.status})${sqlState ? ` SQLSTATE ${sqlState}` : ''}; no sensitive diagnostics emitted`)
    }
    return result.stdout.trim()
  }
  const ready = async (check, label) => {
    for (let i = 0; i < 100; i++) {
      try { if (await check()) return } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error(`Shop ${label} startup failed`)
  }
  const create = (name, image, args, env = {}, command = []) => {
    const id = docker(['create', '--pull', 'never', '--name', `${owner}-${name}`, '--label', `qvesta.test.owner=${owner}`,
      '--network', network, ...args, ...Object.keys(env).flatMap(key => ['-e', key]), image, ...command], undefined, env)
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Missing owned container ID')
    containers.push(id); evidence.created.push(id)
    saveResources()
    const info = JSON.parse(docker(['inspect', id]))[0]
    const host = info.HostConfig
    if (info.Id !== id || info.Config.Labels?.['qvesta.test.owner'] !== owner || host.NetworkMode !== network
      || host.Privileged || host.Binds?.length || host.Mounts?.length || host.VolumesFrom?.length
      || Object.values(host.PortBindings || {}).flat().some(binding => binding.HostIp !== '127.0.0.1')) throw new Error('Shop isolation preflight failed')
    docker(['start', id]); return id
  }
  const binding = (id, port) => {
    const value = docker(['port', id, `${port}/tcp`])
    if (!/^127\.0\.0\.1:\d+$/.test(value)) throw new Error('Shop non-loopback port rejected')
    return `http://${value}`
  }
  try {
    docker(['version', '--format', '{{.Server.Version}}'])
    const images = ['supabase/postgres:17.6.1.165', 'supabase/gotrue:v2.196.0', 'supabase/storage-api:v1.70.3', 'postgrest/postgrest:v16.1']
    evidence.images = images.map(image => ({ image, id: docker(['image', 'inspect', image, '--format', '{{.Id}}']) }))
    resourceCreationAttempted = true
    network = docker(['network', 'create', '--driver', 'bridge', '--label', `qvesta.test.owner=${owner}`, `${owner}-net`])
    saveResources()
    const net = JSON.parse(docker(['network', 'inspect', network]))[0]
    if (net.Labels?.['qvesta.test.owner'] !== owner || Object.keys(net.Containers || {}).length) throw new Error('Network ownership mismatch')
    const database = create('db', images[0], ['--network-alias', 'test-db', '--tmpfs', '/tmp', '--entrypoint', 'sh'], {},
      ['-c', 'mkdir -p /tmp/test-pg /etc/postgresql-custom; chown postgres:postgres /tmp/test-pg /etc/postgresql-custom; gosu postgres initdb -D /tmp/test-pg -A trust >/dev/null && echo "host all all all trust" >> /tmp/test-pg/pg_hba.conf && exec gosu postgres postgres -D /tmp/test-pg -c listen_addresses=* -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/share/postgresql/extension/pgsodium_getkey -c cron.database_name=postgres'])
    await ready(() => docker(['exec', database, 'pg_isready', '-U', 'postgres']).includes('accepting'), 'Postgres')
    const sql = source => docker(['exec', '-i', database, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], source)
    // Same owned database, asynchronous connection for bounded lock-contention tests.
    const sqlAsync = source => new Promise((resolveQuery, rejectQuery) => {
      const child = spawn('docker', [...dockerArgs, 'exec', '-i', database, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
        cwd: root, windowsHide: true, timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'],
      })
      sqlChildren.add(child)
      let output = '', diagnostic = ''
      child.stdout.setEncoding('utf8').on('data', value => { output += value })
      child.stderr.setEncoding('utf8').on('data', value => { diagnostic += value })
      child.on('error', () => rejectQuery(new Error('Owned asynchronous SQL transport failed')))
      child.stdin.on('error', () => { /* close/error reports the bounded transport failure */ })
      child.on('close', code => {
        sqlChildren.delete(child)
        if (code === 0) resolveQuery(output.trim())
        else rejectQuery(new Error(`Owned asynchronous SQL failed; SQLSTATE ${diagnostic.match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1] || 'unknown'}`))
      })
      child.stdin.end(source)
    })
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create role supabase_admin superuser; create role authenticator login noinherit;
      create role dashboard_user; create role supabase_read_only_user;
      grant anon,authenticated,service_role to authenticator with inherit false;
      revoke all on schema public from public; grant usage on schema public to anon,authenticated;
      grant usage,create on schema public to service_role; create schema auth; alter role postgres set search_path=auth,public;`)
    const auth = create('auth', images[1], ['-p', '127.0.0.1::9999'], {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://127.0.0.1:9999', GOTRUE_SITE_URL: 'http://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: 'postgres://postgres@test-db:5432/postgres?sslmode=disable&search_path=auth',
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_LOG_LEVEL: 'fatal',
    })
    const authUrl = binding(auth, 9999)
    await ready(async () => (await fetch(`${authUrl}/health`, { signal: AbortSignal.timeout(1000) })).ok, 'Auth')
    sql(`alter role postgres reset search_path; grant usage on schema auth to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;`)
    sql(fixturePlan.historical.map(row => row.source).join('\n'))
    create('storage', images[2], ['--tmpfs', '/var/lib/storage:mode=1777'], {
      DATABASE_URL: 'postgres://postgres@test-db:5432/postgres?sslmode=disable', AUTH_JWT_SECRET: secret,
      STORAGE_BACKEND: 'file', FILE_STORAGE_BACKEND_PATH: '/var/lib/storage', TENANT_ID: owner, REGION: 'local',
      FILE_SIZE_LIMIT: '1048576', DB_INSTALL_ROLES: 'true', DB_MIGRATIONS_STRATEGY: 'on_start', LOG_LEVEL: 'fatal', S3_PROTOCOL_ENABLED: 'false',
    })
    await ready(() => sql("select to_regclass('storage.objects') is not null") === 't', 'Storage schema')
    sql(fixturePlan.late.map(row => row.source).join('\n'))
    if (sql('select count(*) from cron.job where active') !== '0') throw Error('Unexpected active scheduler in disposable baseline')
    evidence.checks.push({ name: 'migration replay', count: 333, baseline: 327, fixtures: 6, manifestSha256: fixturePlan.manifestSha256, result: 'PASS' })
    evidence.fixture = 'staging source + six SHOP fixtures; not full stage parity; two historical stage ledger releases excluded'
    const rest = create('rest', images[3], ['-p', '127.0.0.1::3000'], {
      PGRST_DB_URI: 'postgres://authenticator@test-db:5432/postgres', PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: secret, PGRST_JWT_AUD: 'authenticated', PGRST_SERVER_PORT: '3000',
    })
    const restUrl = binding(rest, 3000)
    await ready(async () => (await fetch(restUrl, { signal: AbortSignal.timeout(1000) })).ok, 'PostgREST')
    const token = role => {
      const body = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ role, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')].join('.')
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
    }
    const anon = token('anon')
    proxy = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || 'authorization,apikey,content-type,x-client-info,prefer')
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
      const target = request.url.startsWith('/auth/v1/') ? authUrl + request.url.slice(8) : request.url.startsWith('/rest/v1/') ? restUrl + request.url.slice(8) : null
      if (!target) { response.writeHead(404).end(); return }
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const headers = { ...request.headers }; delete headers.host; delete headers['content-length']; delete headers['accept-encoding']
        const upstream = await fetch(target, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined })
        response.statusCode = upstream.status
        for (const [key, value] of upstream.headers) if (!['content-length','content-encoding','transfer-encoding','access-control-allow-origin'].includes(key)) response.setHeader(key, value)
        response.end(Buffer.from(await upstream.arrayBuffer()))
      } catch { response.writeHead(502).end() }
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    await run({ sql, sqlAsync, backend: `http://127.0.0.1:${proxy.address().port}`, ownedUpstreamOrigins: [authUrl, restUrl], anon, service: token('service_role'), evidence, directory })
  } catch (error) { failure = error; evidence.failure = error.message }
  finally {
    await Promise.all([...sqlChildren].map(child => new Promise(resolveClose => {
      child.once('close', resolveClose)
      child.kill()
    })))
    proxy?.closeAllConnections()
    if (proxy) await new Promise(resolve => proxy.close(resolve))
    for (const id of [...containers].reverse()) {
      try { await removeOwnedResource(docker, owner, id); evidence.cleanup.push({ id, removed: true }) }
      catch { evidence.cleanup.push({ id, removed: false }); failure ||= new Error('Owned container cleanup failed') }
    }
    if (network) {
      try { await removeOwnedResource(docker, owner, network, true); evidence.cleanup.push({ id: network, removed: true }) }
      catch { evidence.cleanup.push({ id: network, removed: false }); failure ||= new Error('Owned network cleanup failed') }
    }
    if (resourceCreationAttempted) {
      try {
        const filter = ['--filter', `label=qvesta.test.owner=${owner}`]
        const remaining = {
          containers: docker(['ps', '-aq', '--no-trunc', ...filter]).split(/\s+/).filter(Boolean),
          networks: docker(['network', 'ls', '-q', '--no-trunc', ...filter]).split(/\s+/).filter(Boolean),
          volumes: docker(['volume', 'ls', '-q', ...filter]).split(/\s+/).filter(Boolean),
        }
        evidence.cleanupVerification = { remaining, result: Object.values(remaining).every(ids => ids.length === 0) ? 'PASS' : 'FAIL' }
        if (evidence.cleanupVerification.result !== 'PASS') failure ||= new Error('Owned shop resources remain after cleanup')
      } catch {
        evidence.cleanupVerification = { result: 'UNKNOWN' }
        failure ||= new Error('Owned shop resource absence could not be verified')
      }
    }
    evidence.finishedAt = new Date().toISOString()
    evidence.result = failure ? 'FAIL' : 'PASS'
    writeFileSync(resolve(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
  }
  if (failure) throw failure
}
