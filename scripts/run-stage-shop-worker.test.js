// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { runStageShopWorker, shopWorkerCli } from './run-stage-shop-worker.mjs'

const env = () => ({ SHOP_RUN_ENVIRONMENT: 'staging', SUPABASE_PROJECT_ID: 'jeugfyaqzfgdvfhdxfht',
  GITHUB_REPOSITORY: 'Adoms17/quest-platform', GITHUB_REF: 'refs/heads/staging', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40), SHOP_APPROVED_SHA: 'a'.repeat(40),
  SHOP_PREFLIGHT_ACK: 'exclusive-staging-global-consumer', SHOP_GATEWAY_JWT: 'synthetic.header.signature',
  SHOP_RECONCILIATION_WORKER_TOKEN: 'ab'.repeat(32) })
const summary = () => ({ enabled: true, claimed: 1, reconciled: 1, confirmed: 1, pending: 0,
  missingPaymentId: 0, failed: 0, leaseLost: 0, consumerFailures: 0, fulfillmentFailures: 0, finishFailures: 0, deferred: 0 })
afterEach(() => vi.useRealTimers())

it('sends exactly one fixed SHOP POST with separate auth and no body/redirect/retry', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...summary(), private: env() }))
  const result = await runStageShopWorker(env(), fetcher)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/shop-reconciliation-worker', {
    method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
    headers: { Authorization: `Bearer ${env().SHOP_GATEWAY_JWT}`, 'x-qvesta-worker-token': env().SHOP_RECONCILIATION_WORKER_TOKEN },
  })
  const { enabled: _enabled, ...expected } = summary()
  expect(result).toEqual({ status: 'observed', ...expected })
})
it.each(Object.keys(env()))('missing %s blocks before network', async key => {
  const input = env(); delete input[key]
  const fetcher = vi.fn()
  await expect(runStageShopWorker(input, fetcher)).rejects.toThrow('configuration_rejected')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([
  ['SUPABASE_PROJECT_ID', 'szjiwamevblkpjmmeonf'], ['SUPABASE_PROJECT_ID', 'other'],
  ['SHOP_RUN_ENVIRONMENT', 'production'], ['GITHUB_REF', 'refs/heads/main'],
  ['GITHUB_REPOSITORY', 'other/quest-platform'], ['GITHUB_EVENT_NAME', 'schedule'],
  ['GITHUB_RUN_ATTEMPT', '2'], ['GITHUB_RUN_ID', '0'], ['SHOP_APPROVED_SHA', 'b'.repeat(40)],
  ['GITHUB_SHA', 'invalid'], ['SHOP_PREFLIGHT_ACK', 'true'], ['SHOP_GATEWAY_JWT', 'opaque'],
  ['SHOP_GATEWAY_JWT', 'a.b.c\r\nInjected: yes'], ['SHOP_GATEWAY_JWT', 'a'.repeat(8200)+'.b.c'],
  ['SHOP_RECONCILIATION_WORKER_TOKEN', 'AB'.repeat(32)], ['SHOP_RECONCILIATION_WORKER_TOKEN', 'ab'.repeat(31)],
  ['SHOP_RECONCILIATION_WORKER_TOKEN', 'ab'.repeat(32)+'\n'], ['SHOP_GATEWAY_JWT', 'a.b.c\n'],
  ['GITHUB_RUN_ID', '123\n'], ['GITHUB_SHA', 'a'.repeat(40)+'\n'],
])('invalid %s fails closed', async (key, value) => {
  const fetcher = vi.fn()
  await expect(runStageShopWorker({ ...env(), [key]: value }, fetcher)).rejects.toThrow('configuration_rejected')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([['--order', 'anything'], ['https://other.invalid'], ['--retry'], ['--help']])('rejects CLI input %j', async (...args) => {
  const fetcher = vi.fn()
  expect(await shopWorkerCli({ env: env(), args, fetcher, write: vi.fn() })).toBe(1)
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([301, 302, 307, 308, 401, 403, 429, 500, 503])('rejects HTTP %s without following or retrying', async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response('PRIVATE', { status, headers: { Location: 'https://other.invalid' } }))
  await expect(runStageShopWorker(env(), fetcher)).rejects.toThrow('worker_http_rejected')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('also rejects a transport that reports an already-followed redirect', async () => {
  const response = Response.json(summary()); Object.defineProperty(response, 'redirected', { value: true })
  await expect(runStageShopWorker(env(), vi.fn().mockResolvedValue(response))).rejects.toThrow('worker_http_rejected')
})
it.each([
  {}, { ...summary(), enabled: false }, { ...summary(), claimed: 6 }, { ...summary(), pending: 1 },
  { ...summary(), failed: -1 }, { ...summary(), failed: '0' }, { ...summary(), failed: 2 },
  { ...summary(), fulfillmentFailures: Number.MAX_SAFE_INTEGER + 1 },
])('rejects malformed worker summary', async data => {
  await expect(runStageShopWorker(env(), vi.fn().mockResolvedValue(Response.json(data)))).rejects.toThrow('worker_response_rejected')
})
it.each(['not json', 'x'.repeat(8193)])('bounds and rejects body without echoing it', async body => {
  const write = vi.fn(), fetcher = vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }))
  expect(await shopWorkerCli({ env: env(), args: [], fetcher, write })).toBe(1)
  expect(write).toHaveBeenCalledWith('{"status":"stopped","code":"worker_response_rejected"}')
})
it('rejects wrong content type', async () => {
  await expect(runStageShopWorker(env(), vi.fn().mockResolvedValue(new Response(JSON.stringify(summary()))))).rejects.toThrow('worker_response_rejected')
})
it.each(['fetch', 'body'])('deadline bounds stalled %s even if transport ignores abort; no retry', async where => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockImplementation(() => where === 'fetch' ? new Promise(() => {})
    : Promise.resolve(new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } })))
  const check = expect(runStageShopWorker(env(), fetcher)).rejects.toThrow('worker_outcome_unknown')
  await vi.advanceTimersByTimeAsync(135000)
  await check
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
})
it('transport exceptions are uncertain and secret-free, never retried', async () => {
  const write = vi.fn(), fetcher = vi.fn().mockRejectedValue(new Error(JSON.stringify(env())))
  expect(await shopWorkerCli({ env: env(), args: [], fetcher, write })).toBe(1)
  expect(write).toHaveBeenCalledWith('{"status":"stopped","code":"worker_outcome_unknown"}')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('HTTP failure never reads or prints a body containing secrets', async () => {
  const write = vi.fn(), response = new Response(JSON.stringify(env()), { status: 503 })
  const read = vi.spyOn(response, 'text')
  const fetcher = vi.fn().mockResolvedValue(response)
  expect(await shopWorkerCli({ env: env(), args: [], fetcher, write })).toBe(1)
  expect(read).not.toHaveBeenCalled()
  expect(write).toHaveBeenCalledWith('{"status":"stopped","code":"worker_http_rejected"}')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('prints only whitelist counters, including on attention', async () => {
  const write = vi.fn(), fetcher = vi.fn().mockResolvedValue(Response.json({ ...summary(), consumerFailures: 1,
    token: env().SHOP_RECONCILIATION_WORKER_TOKEN, email: 'synthetic@example.invalid', headers: env(), raw: 'PRIVATE' }))
  expect(await shopWorkerCli({ env: env(), args: [], fetcher, write })).toBe(1)
  const output = write.mock.calls[0][0]
  expect(JSON.parse(output).status).toBe('attention')
  for (const secret of [env().SHOP_GATEWAY_JWT, env().SHOP_RECONCILIATION_WORKER_TOKEN, 'synthetic@example.invalid', 'PRIVATE', 'headers']) expect(output).not.toContain(secret)
})
it('a zero-job result is observed, not a claim that an order was delivered', async () => {
  const data = Object.fromEntries(Object.keys(summary()).map(k => [k, k === 'enabled' ? true : 0]))
  expect(await runStageShopWorker(env(), vi.fn().mockResolvedValue(Response.json(data)))).toMatchObject({ status: 'observed', claimed: 0 })
})
it('unaccounted claimed jobs cannot produce a clean CLI exit', async () => {
  const write = vi.fn()
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...summary(), reconciled: 0, confirmed: 0 }))
  expect(await shopWorkerCli({ env: env(), args: [], fetcher, write })).toBe(1)
  expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({ status: 'attention', claimed: 1, confirmed: 0 })
})
it('does not trust unsigned JWT claims to select target or establish authority', async () => {
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url')
  const jwt = `${encode({ alg: 'none' })}.${encode({ ref: 'szjiwamevblkpjmmeonf', role: 'service_role', exp: 1 })}.synthetic`
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  await expect(runStageShopWorker({ ...env(), SHOP_GATEWAY_JWT: jwt }, fetcher)).rejects.toThrow('worker_http_rejected')
  expect(fetcher.mock.calls[0][0]).toBe('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/shop-reconciliation-worker')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('documents that a second independent invocation is not a durable once-only guard', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(summary()))
  await runStageShopWorker(env(), fetcher)
  await runStageShopWorker(env(), fetcher)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('cancels a stalled body at deadline without retry or secret output', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn(), write = vi.fn()
  const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), {
    headers: { 'content-type': 'application/json' },
  }))
  const result = shopWorkerCli({ env: env(), args: [], fetcher, write })
  await vi.advanceTimersByTimeAsync(135000)
  expect(await result).toBe(1)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith('{"status":"stopped","code":"worker_outcome_unknown"}')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('published workflow is manual-only and gates the protected SHOP invocation', async () => {
  const { readFile } = await import('node:fs/promises')
  const workflow = JSON.parse(await readFile(new URL('../.github/workflows/shop-worker-manual.yml', import.meta.url), 'utf8'))
  expect(workflow.on).toEqual({ workflow_dispatch: {} })
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(workflow.concurrency).toEqual({ group: 'supabase-staging', 'cancel-in-progress': false })
  expect(Object.keys(workflow.jobs)).toEqual(['invoke'])
  const job = workflow.jobs.invoke
  expect(job.environment).toBe('shop-staging-manual')
  for (const condition of ["github.repository == 'Adoms17/quest-platform'", "github.ref == 'refs/heads/staging'", "github.event_name == 'workflow_dispatch'", 'github.run_attempt == 1']) expect(job.if).toContain(condition)
  const steps = job.steps
  for (const variable of ['SHOP_APPROVED_SHA', 'SHOP_APPROVED_RUN_ID', 'SHOP_APPROVED_RUNNER_SHA256']) expect(JSON.stringify(steps[0])).toContain(`vars.${variable}`)
  expect(steps[0].run).toContain('[[ "$GITHUB_RUN_ID" == "$APPROVED_RUN_ID" ]]')
  expect(steps[0].run).toContain('[[ "$GITHUB_SHA" == "$APPROVED_SHA" ]]')
  expect(steps[1].with).toMatchObject({ ref: '${{ github.sha }}', 'persist-credentials': false })
  for (const step of steps.filter(s => s.uses)) expect(step.uses).toMatch(/^actions\/(checkout|setup-node)@[a-f0-9]{40}$/)
  expect(steps.filter(s => JSON.stringify(s).includes('secrets.'))).toEqual([steps.at(-1)])
  expect(steps.at(-1).env).toMatchObject({ SHOP_GATEWAY_JWT: '${{ secrets.SHOP_GATEWAY_JWT }}',
    SHOP_RECONCILIATION_WORKER_TOKEN: '${{ secrets.SHOP_RECONCILIATION_WORKER_TOKEN }}',
    SUPABASE_PROJECT_ID: 'jeugfyaqzfgdvfhdxfht', NODE_OPTIONS: '', NODE_TLS_REJECT_UNAUTHORIZED: '1' })
  expect(steps.filter(s => s.run?.includes('exec node scripts/run-stage-shop-worker.mjs'))).toHaveLength(1)
  expect(JSON.stringify(workflow)).not.toMatch(/workflow_run|pull_request_target|schedule|npm ci|continue-on-error/)
})
