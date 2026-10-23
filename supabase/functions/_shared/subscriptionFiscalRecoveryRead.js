// Server-only, not wired to any endpoint/runtime. An observation is NOT commit authority.
import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
import { createSubscriptionFiscalRefundStorage } from './subscriptionFiscalRefundStorage.js'
import { createSandboxRecoveryReadTransport } from './yookassaSandboxHttp.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = /^[0-9a-f]{64}$/
const fail = () => { throw Error('recovery_read_unconfirmed') }
const isId = value => typeof value === 'string' && uuid.test(value)
const epoch = now => { const n = Math.floor(now() / 1000); if (!Number.isSafeInteger(n)) fail(); return n }
function fresh(identity, now) {
  const time = epoch(now)
  if (!identity || identity.expiresAt <= time || identity.mfaAt > time || identity.mfaAt <= time - 300) fail()
}
function policyOf(policy) {
  const p = structuredClone(policy)
  // Trusted server configuration, never JWT/body-derived. Deliberately no clock grace.
  if (!p || p.audience !== 'authenticated' || p.clockSkewSeconds !== 0 || p.nbfPolicy !== 'validate-if-present') fail()
  const issuer = new URL(p.issuer)
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/auth/v1') fail()
  if (issuer.href !== p.issuer) fail()
  return Object.freeze(p)
}
async function authenticate(auth, token, policy, now) {
  let claims
  const validClaims = c => c?.iss === policy.issuer && c.aud === policy.audience
    && Number.isSafeInteger(c.exp)
    && (!Object.hasOwn(c, 'nbf') || (Number.isSafeInteger(c.nbf) && c.nbf <= epoch(now)))
  const identity = await authenticateRefundOwner({
    async getClaims(bearer) {
      const result = await auth.getClaims(bearer)
      if (result.error || !validClaims(result.data?.claims)) return { error: { message: 'denied' } }
      claims = structuredClone(result.data.claims)
      return { data: { claims } }
    },
    getUser: bearer => auth.getUser(bearer),
  }, token, now)
  // getUser/JWKS waits can exhaust JWT/MFA validity. Never refresh timestamps ourselves.
  fresh(identity, now)
  if (!validClaims(claims)) fail()
  return Object.freeze(identity)
}
function contextOf(value, input, shopId, now) {
  const c = structuredClone(value), e = c?.evidence
  // Only a trusted DB adapter may assert this pin. The status response cannot supply it.
  if (c?.environmentPin?.environment !== 'sandbox' || c.environmentPin.verified !== true
    || c.commandId !== input.commandId || c.evidenceId !== input.evidenceId || c.shopId !== shopId
    || c.kind !== 'refund_before' || c.currency !== 'RUB' || !e || e.id !== c.evidenceId || e.state !== 'succeeded') fail()
  for (const field of ['commandId', 'evidenceId', 'dispatchId', 'organizationId', 'orderId', 'internalRefundId', 'paymentId']) if (!isId(c[field])) fail()
  for (const field of ['bodySha256', 'keyDigest', 'snapshotDigest']) if (typeof c[field] !== 'string' || !digest.test(c[field])) fail()
  if (!Number.isSafeInteger(c.amountMinor) || c.amountMinor <= 0 || !Number.isSafeInteger(c.paymentAmountMinor)
    || c.paymentAmountMinor < c.amountMinor || !isId(e.providerRefundId)) fail()
  const sent = typeof c.firstSentAt === 'string' ? Date.parse(c.firstSentAt) : NaN
  if (!Number.isFinite(sent) || sent > now() || now() - sent >= 23 * 3600000) fail()
  for (const field of ['commandId', 'dispatchId', 'shopId', 'paymentId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt']) {
    if (e[field] !== c[field]) fail()
  }
  // Canonical minimal comparison: no raw operation/body, contact data or credentials.
  return Object.fromEntries([
    ...['commandId', 'evidenceId', 'dispatchId', 'organizationId', 'orderId', 'internalRefundId', 'paymentId', 'shopId', 'kind', 'currency', 'amountMinor', 'paymentAmountMinor', 'bodySha256', 'keyDigest', 'snapshotDigest', 'firstSentAt'].map(key => [key, c[key]]),
    ['providerRefundId', e.providerRefundId],
  ])
}
function checkStatus(status, context) {
  // status.refundId is the INTERNAL refund row ID, never the provider ID.
  if (status?.commandId !== context.commandId || status.refundId !== context.internalRefundId
    || status.environment !== 'sandbox' || status.state !== 'sending' || status.operationState !== 'unknown'
    || status.requiresReview !== false || status.accessEffect !== 'not_applied' || status.receiptStatus !== null) fail()
}
function minor(amount) {
  if (amount?.currency !== 'RUB' || typeof amount.value !== 'string' || !/^\d{1,14}\.\d{2}$/.test(amount.value)) fail()
  const n = BigInt(amount.value.replace('.', ''))
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail()
  return Number(n)
}

export function createSubscriptionFiscalRecoveryRead({ auth, rpc, loadTrustedContext, providerConfig, policy, transport = {}, now = Date.now }) {
  const trustedPolicy = policyOf(policy), config = structuredClone(providerConfig)
  if (typeof auth?.getClaims !== 'function' || typeof auth?.getUser !== 'function'
    || typeof rpc !== 'function' || typeof loadTrustedContext !== 'function') fail()
  // loadTrustedContext is fixture-only until separately approved DB read authority exists.
  const reader = createSandboxRecoveryReadTransport(config, transport)
  return async ({ token, input }) => {
    const request = structuredClone(input)
    if (!request || Object.keys(request).sort().join(',') !== 'client_event_id,commandId,evidenceId'
      || !Object.values(request).every(isId)) fail()
    const identity = await authenticate(auth, token, trustedPolicy, now)
    const statusFor = who => createSubscriptionFiscalRefundStorage({ rpc, identity: who, shopId: config.shopId, commandId: request.commandId }).status()
    const status = await statusFor(identity)
    const context = contextOf(await loadTrustedContext({ identity, commandId: request.commandId, evidenceId: request.evidenceId }), request, config.shopId, now)
    checkStatus(status, context)
    fresh(identity, now)
    const shop = await reader.shop()
    if (shop?.account_id !== context.shopId || shop.test !== true || shop.status !== 'enabled') fail()
    const payment = await reader.payment(context.paymentId)
    if (payment?.id !== context.paymentId || payment.test !== true || payment.status !== 'succeeded' || payment.paid !== true
      || payment.recipient?.account_id !== context.shopId || minor(payment.amount) !== context.paymentAmountMinor) fail()
    const refund = await reader.refund(context.providerRefundId)
    if (refund?.id !== context.providerRefundId || refund.payment_id !== context.paymentId
      || refund.status !== 'succeeded' || minor(refund.amount) !== context.amountMinor) fail()
    const currentIdentity = await authenticate(auth, token, trustedPolicy, now)
    if (currentIdentity.actorId !== identity.actorId) fail()
    const currentStatus = await statusFor(currentIdentity)
    const currentContext = contextOf(await loadTrustedContext({ identity: currentIdentity, commandId: request.commandId, evidenceId: request.evidenceId }), request, config.shopId, now)
    checkStatus(currentStatus, currentContext)
    if (JSON.stringify(currentContext) !== JSON.stringify(context)) fail()
    fresh(currentIdentity, now)
    return Object.freeze({
      kind: 'recovery_a_observation', commitAuthorized: false,
      commandId: context.commandId, evidenceId: context.evidenceId,
      client_event_id: request.client_event_id, // Correlation only, no durable idempotency.
      providerRefundId: context.providerRefundId, paymentId: context.paymentId, shopId: context.shopId,
      amountMinor: context.amountMinor, paymentAmountMinor: context.paymentAmountMinor, currency: 'RUB',
      snapshotDigest: context.snapshotDigest, state: 'succeeded', receiptStatus: 'unknown', observedAt: new Date(now()).toISOString(),
    })
  }
}
