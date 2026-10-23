// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createSubscriptionFiscalRecoveryRead } from './subscriptionFiscalRecoveryRead.js'
import { createSandboxHttpClient, createSandboxRecoveryReadTransport } from './yookassaSandboxHttp.js'

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const actor = id(1), initial = Math.floor(Date.now() / 1000)
const policy = { issuer: 'https://recovery-auth.example.test/auth/v1', audience: 'authenticated', clockSkewSeconds: 0, nbfPolicy: 'validate-if-present' }
const config = { enabled: true, shopId: '123', secretKey: 'synthetic-test-key' }
const input = { commandId: id(2), evidenceId: id(3), client_event_id: id(4) }
const claims = () => ({ iss: policy.issuer, aud: policy.audience, sub: actor, role: 'authenticated', aal: 'aal2', exp: initial + 240, amr: [{ method: 'totp', timestamp: initial - 10 }] })
const context = () => {
  const c = { environmentPin: { environment: 'sandbox', verified: true }, commandId: input.commandId, evidenceId: input.evidenceId,
    dispatchId: id(5), organizationId: id(6), orderId: id(7), internalRefundId: id(8), paymentId: id(9), shopId: '123',
    kind: 'refund_before', amountMinor: 2000, paymentAmountMinor: 99000, currency: 'RUB', bodySha256: 'a'.repeat(64), keyDigest: 'b'.repeat(64),
    snapshotDigest: 'c'.repeat(64), firstSentAt: new Date((initial - 30) * 1000).toISOString() }
  c.evidence = { id: c.evidenceId, providerRefundId: id(10), state: 'succeeded' }
  for (const key of ['commandId', 'dispatchId', 'paymentId', 'shopId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt']) c.evidence[key] = c[key]
  return c
}
const status = () => ({ commandId: input.commandId, refundId: id(8), environment: 'sandbox', state: 'sending', operationState: 'unknown', receiptStatus: null, requiresReview: false, accessEffect: 'not_applied' })
function harness() {
  let time = initial * 1000
  const h = { context: context(), status: status(), claims: claims(), userId: actor, now: () => time, advance: seconds => { time += seconds * 1000 } }
  h.resources = {
    me: { account_id: '123', test: true, status: 'enabled' },
    [`payments/${id(9)}`]: { id: id(9), test: true, status: 'succeeded', paid: true, recipient: { account_id: '123' }, amount: { value: '990.00', currency: 'RUB' } },
    [`refunds/${id(10)}`]: { id: id(10), payment_id: id(9), status: 'succeeded', amount: { value: '20.00', currency: 'RUB' } },
  }
  h.auth = {
    getClaims: vi.fn(async () => ({ data: { claims: structuredClone(h.claims) } })),
    getUser: vi.fn(async () => ({ data: { user: { id: h.userId } } })),
  }
  h.rpc = vi.fn(async (name, args) => {
    expect(name).toBe('subscription_fiscal_refund_from_gateway')
    expect(args.p_action).toBe('status'); expect(args.p_result).toBeNull()
    expect(args.p_command_id).toBe(input.commandId); expect(args.p_shop_id).toBe('123')
    return { data: structuredClone(h.status), error: null }
  })
  h.load = vi.fn(async () => structuredClone(h.context))
  h.fetch = vi.fn(async (url, options) => {
    expect(options.method).toBe('GET'); expect(options.redirect).toBe('error'); expect(options.body).toBeUndefined()
    expect(url.startsWith('https://api.yookassa.ru/v3/')).toBe(true)
    const key = url.slice('https://api.yookassa.ru/v3/'.length)
    if (!Object.hasOwn(h.resources, key)) throw Error('unexpected provider URL')
    return Response.json(h.resources[key])
  })
  h.options = () => ({ auth: h.auth, rpc: h.rpc, loadTrustedContext: h.load, providerConfig: config, policy, transport: { fetchImpl: h.fetch }, now: h.now })
  h.run = (request = input) => createSubscriptionFiscalRecoveryRead(h.options())({ token: 'synthetic', input: request })
  return h
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('external network forbidden') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('only fixed three GETs; partial refund differs from total payment; no writes or hooks', async () => {
  const h = harness(), before = structuredClone(h.context), write = vi.fn(() => { throw Error('write forbidden') })
  const read = createSubscriptionFiscalRecoveryRead({ ...h.options(), transport: { fetchImpl: h.fetch, receipts: { record: write }, refundReceipts: { record: write }, beforeFiscalSend: write } })
  const result = await read({ token: 'synthetic', input })
  expect(result).toMatchObject({ kind: 'recovery_a_observation', commitAuthorized: false, amountMinor: 2000, paymentAmountMinor: 99000,
    providerRefundId: id(10), state: 'succeeded', receiptStatus: 'unknown', client_event_id: input.client_event_id })
  expect(Object.isFrozen(result)).toBe(true)
  expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['me', `payments/${id(9)}`, `refunds/${id(10)}`].map(path => `https://api.yookassa.ru/v3/${path}`))
  for (const [, options] of h.fetch.mock.calls) {
    expect(options.headers.Authorization).toBe(`Basic ${btoa('123:synthetic-test-key')}`)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  }
  expect(h.rpc).toHaveBeenCalledTimes(2); expect(h.load).toHaveBeenCalledTimes(2)
  expect(h.auth.getClaims).toHaveBeenCalledTimes(2); expect(h.auth.getUser).toHaveBeenCalledTimes(2)
  expect(h.context).toEqual(before); expect(write).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toMatch(/synthetic|Bearer|secret|environmentPin|internalRefundId/)
})
test('correlation event is not durable idempotency; each read makes fresh GETs', async () => {
  const h = harness(); await h.run(); await h.run(); expect(h.fetch).toHaveBeenCalledTimes(6)
  expect(h.rpc.mock.calls.every(([, args]) => args.p_action === 'status')).toBe(true)
})
test('deployed client method set has no recovery reader', () => {
  const client = createSandboxHttpClient(config, { fetchImpl: vi.fn() })
  expect(Object.keys(client)).toEqual(['createSettlement', 'findSettlement', 'readSettlement', 'createFiscalOperation', 'readFiscalOperation', 'verifyShop', 'createRefund', 'readRefund', 'findPayment', 'createRecurringPayment', 'createPayment', 'readPayment'])
})
test.each([
  { iss: 'https://foreign.example.test/auth/v1' }, { aud: 'other' }, { aud: ['authenticated'] }, { exp: initial },
  { exp: initial + 0.5 }, { nbf: initial + 1 }, { nbf: '0' }, { nbf: null }, { role: 'service_role' }, { aal: 'aal1' },
  { amr: [{ method: 'totp', timestamp: initial - 300 }] }, { amr: [{ method: 'totp', timestamp: initial + 1 }] },
])('rejects invalid claims before DB/provider %j', async change => {
  const h = harness(); Object.assign(h.claims, change)
  await expect(h.run()).rejects.toThrow(); expect(h.rpc).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each([{}, { nbf: initial }, { nbf: initial - 1 }])('allows absent/past/current nbf with zero skew %j', async change => {
  const h = harness(); Object.assign(h.claims, change); await expect(h.run()).resolves.toHaveProperty('commitAuthorized', false)
})
test.each([{ clockSkewSeconds: 1 }, { issuer: 'http://bad/auth/v1' }, { issuer: 'https://bad/auth/v1?key=x' }, { audience: 'other' }, { nbfPolicy: 'ignore' }])('rejects invalid trusted policy %j', change => {
  const h = harness(); expect(() => createSubscriptionFiscalRecoveryRead({ ...h.options(), policy: { ...policy, ...change } })).toThrow()
})
test.each(['commandId', 'evidenceId', 'client_event_id'])('rejects invalid request %s before Auth', async key => {
  const h = harness(); await expect(h.run({ ...input, [key]: '../../other' })).rejects.toThrow(); expect(h.auth.getClaims).not.toHaveBeenCalled()
})
test('client provider ID is rejected; absent trusted evidence is B', async () => {
  const h = harness(); await expect(h.run({ ...input, providerRefundId: id(10) })).rejects.toThrow()
  delete h.context.evidence; await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each(['commandId', 'dispatchId', 'paymentId', 'shopId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt'])('rejects evidence binding mismatch %s', async field => {
  const h = harness(); h.context.evidence[field] = 'mismatch'
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each(['environmentPin', 'snapshotDigest', 'evidenceId', 'internalRefundId', 'organizationId', 'orderId'])('requires trusted context field %s', async field => {
  const h = harness(); delete h.context[field]; await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each(['production', 'unconfigured'])('status sandbox string cannot replace DB pin: %s', async environment => {
  const h = harness(); h.context.environmentPin.environment = environment
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each([
  ['environmentPin', { environment: 'sandbox', verified: false }], ['kind', 'refund_after'], ['kind', 'settlement'],
  ['amountMinor', 0], ['amountMinor', -1], ['paymentAmountMinor', 1999], ['paymentAmountMinor', Number.MAX_SAFE_INTEGER + 1],
])('rejects invalid trusted bounds %s', async (field, value) => {
  const h = harness(); h.context[field] = value; await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each(['providerRefundId', 'state', 'id'])('requires exact evidence %s', async field => {
  const h = harness(); h.context.evidence[field] = 'invalid'; await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each([{ requiresReview: true }, { accessEffect: 'applied' }, { state: 'reserved' }, { operationState: 'succeeded' }, { receiptStatus: 'succeeded' }])('rejects ineligible status %j', async change => {
  const h = harness(); Object.assign(h.status, change); await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each([23 * 3600, -1])('rejects aged/future dispatch %s', async age => {
  const h = harness(); h.context.firstSentAt = h.context.evidence.firstSentAt = new Date((initial - age) * 1000).toISOString()
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled()
})
test.each([
  ['me', 'account_id', 'foreign'], ['me', 'test', false], ['me', 'status', 'disabled'],
  [`payments/${id(9)}`, 'id', id(20)], [`payments/${id(9)}`, 'test', false], [`payments/${id(9)}`, 'paid', false],
  [`payments/${id(9)}`, 'status', 'pending'], [`payments/${id(9)}`, 'recipient', { account_id: 'foreign' }],
  [`payments/${id(9)}`, 'amount', { value: '20.00', currency: 'RUB' }],
  [`refunds/${id(10)}`, 'id', id(20)], [`refunds/${id(10)}`, 'payment_id', id(20)],
  [`refunds/${id(10)}`, 'status', 'pending'], [`refunds/${id(10)}`, 'status', 'canceled'],
  [`refunds/${id(10)}`, 'amount', { value: '990.00', currency: 'RUB' }],
  [`refunds/${id(10)}`, 'amount', { value: '20.00', currency: 'USD' }],
  [`refunds/${id(10)}`, 'amount', { value: '20', currency: 'RUB' }],
])('refuses provider mismatch %s.%s', async (path, field, value) => {
  const h = harness(); h.resources[path][field] = value; await expect(h.run()).rejects.toThrow()
})
test.each(['me', `payments/${id(9)}`, `refunds/${id(10)}`])('rejects missing provider fields in %s', async path => {
  const h = harness(); h.resources[path] = {}; await expect(h.run()).rejects.toThrow()
})
test.each([302, 404, 429, 500])('HTTP %s remains unconfirmed and never retries', async code => {
  const h = harness(); h.fetch.mockResolvedValue(new Response('', { status: code, headers: { Location: 'https://foreign.example.test' } }))
  await expect(h.run()).rejects.toThrow('provider_read_failed'); expect(h.fetch).toHaveBeenCalledTimes(1)
})
test('invalid JSON remains unconfirmed', async () => {
  const h = harness(); h.fetch.mockResolvedValue(new Response('bad-json')); await expect(h.run()).rejects.toThrow('provider_read_failed')
})
test('timeout aborts fake transport without another request and clears timers', async () => {
  vi.useFakeTimers()
  try {
    const h = harness(); h.fetch.mockImplementation((_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true })))
    const read = createSubscriptionFiscalRecoveryRead({ ...h.options(), transport: { fetchImpl: h.fetch, timeoutMs: 10 } })
    const assertion = expect(read({ token: 'synthetic', input })).rejects.toThrow('provider_read_failed')
    await vi.advanceTimersByTimeAsync(11); await assertion
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
test.each(['payment', 'refund'])('narrow transport refuses arbitrary URL in %s', method => {
  const fetchImpl = vi.fn(), reader = createSandboxRecoveryReadTransport(config, { fetchImpl })
  expect(() => reader[method]('https://evil.example.test')).toThrow('invalid_recovery_id'); expect(fetchImpl).not.toHaveBeenCalled()
  expect(Object.keys(reader)).toEqual(['shop', 'payment', 'refund'])
})
test.each(['initial', 'after_get'])('DB role/scope denial at %s returns no observation', async phase => {
  const h = harness()
  if (phase === 'after_get') h.rpc.mockResolvedValueOnce({ data: status() })
  h.rpc.mockResolvedValue({ error: { code: '42501' } })
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 3)
})
test.each(['user', 'subject', 'mfa', 'expiry', 'status', 'scope', 'snapshot', 'internal_id', 'provider_id'])('refuses post-GET change %s', async change => {
  const h = harness(), original = h.fetch.getMockImplementation()
  h.fetch.mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[0].includes('/refunds/')) {
      if (change === 'user') h.userId = id(90)
      if (change === 'subject') { h.claims.sub = id(90); h.userId = id(90) }
      if (change === 'mfa') h.claims.amr[0].timestamp = initial - 300
      if (change === 'expiry') h.advance(241)
      if (change === 'status') h.status.requiresReview = true
      if (change === 'scope') h.context.organizationId = id(90)
      if (change === 'snapshot') h.context.snapshotDigest = 'd'.repeat(64)
      if (change === 'internal_id') h.status.refundId = id(10) // Provider ID is not the row ID.
      if (change === 'provider_id') h.context.evidence.providerRefundId = id(90)
    }
    return response
  })
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).toHaveBeenCalledTimes(3)
})
test.each(['initial_auth', 'final_auth', 'final_status', 'final_context'])('checks clock after async %s wait', async phase => {
  const h = harness()
  if (phase.endsWith('auth')) {
    let count = 0
    h.auth.getUser.mockImplementation(async () => { if (++count === (phase === 'initial_auth' ? 1 : 2)) h.advance(300); return { data: { user: { id: actor } } } })
  } else {
    const fn = phase === 'final_status' ? h.rpc : h.load, original = fn.getMockImplementation(); let count = 0
    fn.mockImplementation(async (...args) => { const r = await original(...args); if (++count === 2) h.advance(300); return r })
  }
  await expect(h.run()).rejects.toThrow(); expect(h.fetch).toHaveBeenCalledTimes(phase === 'initial_auth' ? 0 : 3)
})
test('post-GET status uses newly verified identity timestamps', async () => {
  const h = harness(), original = h.fetch.getMockImplementation()
  h.fetch.mockImplementation(async (...args) => { const response = await original(...args); if (args[0].includes('/refunds/')) { h.claims.exp++; h.claims.amr[0].timestamp++ } return response })
  await h.run()
  expect(h.rpc.mock.calls[1][1].p_expires_at).toBe(h.rpc.mock.calls[0][1].p_expires_at + 1)
  expect(h.rpc.mock.calls[1][1].p_mfa_at).toBe(h.rpc.mock.calls[0][1].p_mfa_at + 1)
})

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function signed(payload, privateKey, kid) {
  const body = `${encode({ alg: 'ES256', typ: 'JWT', kid })}.${encode(payload)}`
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(body))
  return `${body}.${Buffer.from(signature).toString('base64url')}`
}
test('real SDK validates ephemeral ES256 signature via trusted JWKS, rejects forgery/wrong key before getUser', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const wrong = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = `ephemeral-${crypto.randomUUID()}`
  const jwk = { ...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid, alg: 'ES256', use: 'sig' }
  const payload = claims(), good = await signed(payload, pair.privateKey, kid)
  const bad = await signed(payload, wrong.privateKey, kid)
  const segments = good.split('.'); segments[1] = encode({ ...payload, sub: id(99) }); const forged = segments.join('.')
  const calls = []; let revoked = false
  const sdkFetch = async (url, options) => {
    const target = String(url); calls.push(target)
    expect(options.method).toBe('GET')
    if (target === `${policy.issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] })
    if (target === `${policy.issuer}/user`) {
      // Refuse every token except the known valid synthetic token; no permissive fallback.
      const bearer = new Headers(options.headers).get('Authorization')
      if (revoked || bearer !== `Bearer ${good}`) return Response.json({ message: 'denied' }, { status: 401 })
      return Response.json({ id: actor, aud: 'authenticated', role: 'authenticated' })
    }
    throw Error('unexpected Auth/JWKS URL')
  }
  vi.stubGlobal('crypto', webcrypto)
  const verify = vi.spyOn(webcrypto.subtle, 'verify')
  const client = createClient('https://recovery-auth.example.test', 'synthetic-anon', { global: { fetch: sdkFetch }, auth: { storageKey: kid, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  try {
    const h = harness(), read = createSubscriptionFiscalRecoveryRead({ ...h.options(), auth: client.auth })
    await expect(read({ token: good, input })).resolves.toHaveProperty('commitAuthorized', false)
    expect(calls.filter(url => url.endsWith('/user'))).toHaveLength(2)
    expect(calls.filter(url => url.endsWith('/.well-known/jwks.json'))).toHaveLength(1)
    expect(verify).toHaveBeenCalledTimes(2)
    for (const token of [bad, forged]) {
      const usersBefore = calls.filter(url => url.endsWith('/user')).length, readsBefore = h.fetch.mock.calls.length
      await expect(read({ token, input })).rejects.toThrow()
      expect(calls.filter(url => url.endsWith('/user'))).toHaveLength(usersBefore)
      expect(h.fetch).toHaveBeenCalledTimes(readsBefore)
    }
    expect(verify).toHaveBeenCalledTimes(4)
    for (const change of [{ iss: 'https://attacker.example.test/auth/v1' }, { aud: 'other' }, { nbf: initial + 500 }]) {
      const token = await signed({ ...payload, ...change }, pair.privateKey, kid)
      await expect(read({ token, input })).rejects.toThrow()
      expect(calls.filter(url => url.endsWith('/user'))).toHaveLength(2)
    }
    expect(calls.every(url => [policy.issuer + '/user', policy.issuer + '/.well-known/jwks.json'].includes(url))).toBe(true)
    revoked = true
    await expect(read({ token: good, input })).rejects.toThrow()
    expect(h.fetch).toHaveBeenCalledTimes(3) // Fake revocation reaction, not a hosted guarantee.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  } finally {
    await client.auth.stopAutoRefresh()
    // SDK has a per-storageKey in-memory JWKS cache. Clear this test's isolated entry.
    client.auth.jwks = { keys: [] }
    client.auth.jwks_cached_at = Number.MIN_SAFE_INTEGER
    verify.mockRestore()
    vi.unstubAllGlobals()
    // Private keys and tokens only lived in this test's memory; no files or live JWKS overrides.
  }
})
