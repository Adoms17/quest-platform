// @vitest-environment node
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createSubscriptionFiscalRecoveryContextStorage } from './subscriptionFiscalRecoveryContextStorage.js'
import { createSubscriptionFiscalRecoveryRead } from './subscriptionFiscalRecoveryRead.js'
import { recoveryContextFixture, recoveryContextId as id } from '../../../scripts/fixtures/fiscal-recovery-context.js'

const epoch = Date.parse('2026-10-08T22:01:00Z') / 1000
const identity = () => ({ actorId: id(8), aal: 'aal2', mfaAt: epoch - 10, expiresAt: epoch + 120 })
function setup() {
  let time = epoch * 1000
  const h = { data: recoveryContextFixture(), now: () => time, advance: n => { time += n * 1000 } }
  h.request = { identity: identity(), commandId: h.data.commandId, evidenceId: h.data.evidenceId }
  h.rpc = vi.fn(async () => ({ data: h.data }))
  h.load = createSubscriptionFiscalRecoveryContextStorage({ rpc: h.rpc, shopId: '123', now: h.now })
  return h
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw Error('external network forbidden') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
test('R only: exact trusted arguments, canonical microseconds preserved, defensive immutable projection', async () => {
  const h = setup(), result = await h.load(h.request)
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('subscription_fiscal_refund_from_gateway', {
    p_actor_user_id: id(8), p_mfa_at: epoch - 10, p_expires_at: epoch + 120,
    p_shop_id: '123', p_action: 'read_recovery_context', p_command_id: id(1), p_result: { evidenceId: id(2) },
  })
  expect(result.firstSentAt).toBe('2026-10-08T22:00:00.123456Z')
  expect(result.dispatchId).toBe(result.internalRefundId)
  expect(result.evidence.providerRefundId).not.toBe(result.internalRefundId)
  expect(result).toEqual(h.data); expect(result).not.toBe(h.data)
  expect(Object.isFrozen(result.evidence)).toBe(true); expect(Object.isFrozen(result.environmentPin)).toBe(true)
  h.data.evidence.providerRefundId = id(99); expect(result.evidence.providerRefundId).toBe(id(7))
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
test.each(['commandId', 'evidenceId'])('rejects malformed request %s before RPC', async field => {
  const h = setup(); h.request[field] = 'foreign'; await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable'); expect(h.rpc).not.toHaveBeenCalled()
})
test.each([{ aal: 'aal1' }, { actorId: null }, { mfaAt: epoch - 300 }, { mfaAt: epoch + 1 }, { expiresAt: epoch }, { expiresAt: 1.2 }])('rejects unverified/expired identity %j', async change => {
  const h = setup(); Object.assign(h.request.identity, change); await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable'); expect(h.rpc).not.toHaveBeenCalled()
})
test('refuses extra operator-supplied provider identity', async () => {
  const h = setup(); h.request.providerRefundId = id(7); await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable'); expect(h.rpc).not.toHaveBeenCalled()
})
test.each(['exp', 'mfa'])('rechecks %s after asynchronous RPC/lock wait', async mode => {
  const h = setup(); if (mode === 'mfa') h.request.identity.expiresAt = epoch + 1000
  h.rpc.mockImplementation(async () => { h.advance(mode === 'exp' ? 120 : 290); return { data: h.data } })
  await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
})
test('caller mutation during RPC cannot replace captured actor or extend expiry', async () => {
  const h = setup(); h.rpc.mockImplementation(async () => { h.request.identity.expiresAt += 999; h.request.identity.actorId = id(99); h.advance(120); return { data: h.data } })
  await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
  expect(h.rpc.mock.calls[0][1].p_actor_user_id).toBe(id(8))
})
test.each(['missing', 'foreign', 'denied', 'transport'])('uniform denial does not leak evidence/provider IDs: %s', async kind => {
  const h = setup(), sensitive = `foreign-provider-${id(77)}`
  if (kind === 'missing') h.rpc.mockResolvedValue({ data: null })
  if (kind === 'foreign') h.rpc.mockResolvedValue({ data: { ...h.data, evidenceId: id(99), evidence: { secret: sensitive } } })
  if (kind === 'denied') h.rpc.mockResolvedValue({ data: h.data, error: { code: '42501', message: sensitive, details: sensitive } })
  if (kind === 'transport') h.rpc.mockRejectedValue(Error(sensitive))
  await expect(h.load(h.request)).rejects.toEqual(Error('recovery_context_unavailable'))
})
test.each(['environmentPin', 'dispatchId', 'organizationId', 'orderId', 'internalRefundId', 'paymentId', 'evidence', 'snapshotDigest', 'paymentAmountMinor'])('requires returned field %s', async field => {
  const h = setup(); delete h.data[field]; await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
})
test.each(['commandId', 'dispatchId', 'shopId', 'paymentId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt'])('rejects evidence mismatch %s', async field => {
  const h = setup(); h.data.evidence[field] = 'foreign'; await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
})
test.each([
  ['dispatchId', id(99)], ['shopId', 'foreign'], ['kind', 'settlement'], ['currency', 'USD'],
  ['amountMinor', 0], ['paymentAmountMinor', 1], ['paymentAmountMinor', Number.MAX_SAFE_INTEGER + 1],
  ['snapshotDigest', 'invalid'], ['firstSentAt', '2026-10-08T22:00:00.123Z'],
  ['environmentPin', { environment: 'production', verified: true }], ['environmentPin', { environment: 'sandbox', verified: false }],
])('rejects invalid projection %s', async (field, value) => {
  const h = setup(); h.data[field] = value; await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
})
test.each(['root', 'evidence', 'pin'])('does not forward unexpected/raw fields from %s', async where => {
  const h = setup(), target = where === 'root' ? h.data : where === 'pin' ? h.data.environmentPin : h.data.evidence
  target.rawBody = { contact: 'synthetic@example.test' }; await expect(h.load(h.request)).rejects.toThrow('recovery_context_unavailable')
})
test('unwired composition with PR167 performs R/status reads and three GETs only', async () => {
  const h = setup(), calls = [], context = h.data, authIdentity = identity()
  const rpc = vi.fn(async (name, args) => {
    calls.push(args.p_action)
    if (args.p_action === 'read_recovery_context') return { data: structuredClone(context) }
    if (args.p_action === 'status') return { data: { commandId: context.commandId, refundId: context.internalRefundId, environment: 'sandbox', state: 'sending', operationState: 'unknown', receiptStatus: null, requiresReview: false, accessEffect: 'not_applied' } }
    throw Error('write action forbidden')
  })
  const fetchImpl = vi.fn(async (url, options) => {
    expect(options.method).toBe('GET')
    if (url === 'https://api.yookassa.ru/v3/me') return Response.json({ account_id: '123', test: true, status: 'enabled' })
    if (url === `https://api.yookassa.ru/v3/payments/${context.paymentId}`) return Response.json({ id: context.paymentId, test: true, status: 'succeeded', paid: true, recipient: { account_id: '123' }, amount: { value: '990.00', currency: 'RUB' } })
    if (url === `https://api.yookassa.ru/v3/refunds/${context.evidence.providerRefundId}`) return Response.json({ id: context.evidence.providerRefundId, payment_id: context.paymentId, status: 'succeeded', amount: { value: '20.00', currency: 'RUB' } })
    throw Error('unapproved URL')
  })
  const policy = { issuer: 'https://synthetic.example.test/auth/v1', audience: 'authenticated', clockSkewSeconds: 0, nbfPolicy: 'validate-if-present' }
  const read = createSubscriptionFiscalRecoveryRead({ rpc,
    auth: { getClaims: async () => ({ data: { claims: { sub: authIdentity.actorId, iss: policy.issuer, aud: policy.audience, role: 'authenticated', aal: 'aal2', exp: authIdentity.expiresAt, amr: [{ method: 'totp', timestamp: authIdentity.mfaAt }] } } }), getUser: async () => ({ data: { user: { id: authIdentity.actorId } } }) },
    loadTrustedContext: createSubscriptionFiscalRecoveryContextStorage({ rpc, shopId: '123', now: h.now }),
    providerConfig: { enabled: true, shopId: '123', secretKey: 'synthetic-test-key' }, policy, now: h.now, transport: { fetchImpl },
  })
  expect(await read({ token: 'synthetic', input: { commandId: context.commandId, evidenceId: context.evidenceId, client_event_id: id(9) } })).toMatchObject({ commitAuthorized: false, receiptStatus: 'unknown' })
  expect(calls).toEqual(['status', 'read_recovery_context', 'status', 'read_recovery_context'])
  expect(fetchImpl).toHaveBeenCalledTimes(3); expect(globalThis.fetch).not.toHaveBeenCalled()
})

// File contract checks only: NOT SQL execution, ACL/RLS acceptance or a lock test.
const sql = readFileSync(new URL('../../../scripts/fiscal-recovery-context.candidate.sql', import.meta.url), 'utf8')
test('candidate is outside migrations; one new R action and no new grants', () => {
  expect(readdirSync(new URL('../../migrations/', import.meta.url)).some(name => name.includes('recovery_context'))).toBe(false)
  expect(sql).not.toMatch(/^\s*grant\s/im)
  expect(sql).toContain("'read_recovery_context'")
  expect(sql).toContain('final_acl is distinct from original_acl')
  expect(sql).not.toMatch(/p_action\s*=\s*'(append_recovery_evidence|commit_recovery_a)'/)
})
test('reader body has no DML and checks DB clock after final lock/permission calls', () => {
  const body = sql.split("set timezone='UTC' as $$")[1].split('$$;')[0]
  expect(body).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate\s+|execute\s+)/i)
  const barrier = body.slice(body.indexOf('-- FINAL DB-CLOCK BARRIER'))
  expect(barrier.indexOf('epoch:=extract(epoch from clock_timestamp())')).toBeGreaterThan(barrier.lastIndexOf('perform platform_private.require_sandbox_environment()'))
  expect(barrier).toContain('p_mfa<=epoch-300'); expect(barrier).toContain('p_exp<=epoch')
  expect(barrier.slice(barrier.indexOf('epoch:=extract'))).not.toMatch(/\b(select|perform)\b/i)
  expect(body).toContain("raise exception 'recovery context denied' using errcode='42501'")
})
