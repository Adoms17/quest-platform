import { buildSubscriptionReceipt, ReceiptDataError } from './subscriptionReceipt.js'

// MODEL-03 calculation contract only. Call with a complete, ordered ledger read
// under the order lock. This module neither reserves funds nor authorizes HTTP.
const SCALE = 1000000n
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw new ReceiptDataError(code) }
const invalid = () => fail('invalid_fiscal_ledger')
function money(value, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) invalid()
  return BigInt(value)
}
function units(value) {
  if (typeof value !== 'string' || !/^(0\.\d{6}|1\.000000)$/.test(value)) invalid()
  const result = BigInt(value.replace('.', ''))
  if (result <= 0n) invalid()
  return result
}
const quantity = value => `${value / SCALE}.${String(value % SCALE).padStart(6, '0')}`
const amount = value => ({value:`${value / 100n}.${String(value % 100n).padStart(2,'0')}`,currency:'RUB'})
const rounded = (price, count) => (2n * price * count + SCALE) / (2n * SCALE)

export function inspectSubscriptionFiscalLedger(ledger) {
  if (!ledger || !uuid.test(ledger.paymentId) || ledger.currency !== 'RUB' || !Number.isSafeInteger(ledger.version) || ledger.version < 0
    || !Array.isArray(ledger.operations) || ledger.operations.length > 1000 || ledger.version < ledger.operations.length) invalid()
  const paid = money(ledger.paidMinor, true), ids = new Set()
  let before = 0n, after = 0n, refundedUnits = 0n, settled = 0n, reserved = 0n
  let settlementSeen = false, settlementConfirmed = false, blocked = false, review = false
  for (const op of ledger.operations) {
    if (!op || !uuid.test(op.id) || ids.has(op.id.toLowerCase()) || blocked
      || !['refund_before','settlement','refund_after'].includes(op.kind)
      || !['reserved','unknown','pending','succeeded','canceled','rejected'].includes(op.state)) invalid()
    ids.add(op.id.toLowerCase())
    const value = money(op.amountMinor, true), count = units(op.quantity)
    if (value > paid || rounded(paid,count) !== value) invalid()
    const isSettlement = op.kind === 'settlement'
    if (isSettlement) {
      if (settlementSeen || value !== paid - before || count !== SCALE - refundedUnits) invalid()
      settlementSeen = true
    } else {
      if (op.kind === 'refund_before' && settlementSeen) invalid()
      if (op.kind === 'refund_after' && !settlementConfirmed) invalid()
      if (value > paid - before - after || count > SCALE - refundedUnits) invalid()
    }
    if (op.state === 'canceled' || op.state === 'rejected') {
      if (op.receiptStatus !== null) invalid()
      // A rejected/canceled settlement retains its immutable request for review.
      if (isSettlement) { blocked = true; review = true }
      continue
    }
    if (op.state !== 'succeeded') {
      if (op.receiptStatus !== null) invalid()
      reserved = isSettlement ? 0n : value
      blocked = true
      continue
    }
    if (!['unknown','pending','succeeded','canceled'].includes(op.receiptStatus)) invalid()
    if (isSettlement) {
      settled = value
      settlementConfirmed = op.receiptStatus === 'succeeded'
    } else {
      if (op.kind === 'refund_before') before += value
      else after += value
      refundedUnits += count
    }
    if (op.receiptStatus !== 'succeeded') {
      blocked = true
      review = op.receiptStatus === 'canceled'
    }
  }
  const remaining = paid - before - after
  // A zero monetary balance must not leave an unreturned fractional item.
  if (rounded(paid,SCALE-refundedUnits) !== remaining || (remaining === 0n && refundedUnits !== SCALE)) invalid()
  return {
    version:ledger.version, paymentId:ledger.paymentId, paidMinor:Number(paid), refundedBeforeMinor:Number(before),
    refundedAfterMinor:Number(after), settledMinor:Number(settled), reservedRefundMinor:Number(reserved),
    remainingMinor:Number(remaining), availableRefundMinor:Number(remaining - reserved),
    remainingQuantity:quantity(SCALE-refundedUnits), settlementConfirmed,
    canSettle:!blocked && !settlementSeen && remaining > 0n,
    canRefund:!blocked && remaining > 0n,
    refundMode:settlementConfirmed?'full_payment':'full_prepayment',
    reason:review?'requires_review':blocked?'operation_unresolved':remaining===0n?'fully_refunded':null,
  }
}

export function prepareSubscriptionFiscalOperation(snapshot, payment, ledger, command) {
  const receipt = buildSubscriptionReceipt(snapshot)
  const balance = inspectSubscriptionFiscalLedger(ledger)
  if (snapshot.paymentMode !== 'full_prepayment' || snapshot.paymentSubject !== 'service'
    || !payment || !uuid.test(payment.id) || payment.id !== ledger.paymentId || payment.status !== 'succeeded'
    || payment.receiptRegistration !== 'succeeded' || payment.currency !== 'RUB'
    || payment.amountMinor !== snapshot.amountMinor || payment.amountMinor !== balance.paidMinor
    || payment.refundedAmountMinor !== balance.refundedBeforeMinor + balance.refundedAfterMinor
    || payment.requiresReview !== false) fail('fiscal_payment_unverified')
  if (!command || !uuid.test(command.id) || !['refund','settlement'].includes(command.kind)
    || command.expectedVersion !== ledger.version
    || ledger.operations.some(op => op.id.toLowerCase() === command.id.toLowerCase())) fail('fiscal_command_changed')
  const settle = command.kind === 'settlement'
  if (!(settle ? balance.canSettle : balance.canRefund)) fail('fiscal_operation_unavailable')
  const target = money(command.amountMinor,true), remaining = BigInt(balance.remainingMinor)
  if (target > remaining || (settle && target !== remaining)) fail('fiscal_amount_unavailable')
  // Preserve the existing provider rule: a partial refund and its residual
  // must each be >= 1 RUB. The full residual may be returned in one operation.
  if (!settle && target < remaining && (target < 100n || remaining-target < 100n)) fail('fiscal_refund_limits')
  const price = BigInt(snapshot.amountMinor), remainingUnits = units(balance.remainingQuantity)
  const count = target === remaining ? remainingUnits : (2n * target * SCALE + price) / (2n * price)
  if (count <= 0n || count > remainingUnits || rounded(price,count) !== target
    || rounded(price,remainingUnits-count) !== remaining-target) fail('fiscal_quantity_unrepresentable')
  const mode = settle ? 'full_payment' : balance.refundMode
  const item = {...receipt.items[0],quantity:quantity(count),payment_mode:mode}
  const body = settle
    ? {type:'payment',payment_id:payment.id,send:true,customer:receipt.customer,items:[item],settlements:[{type:'prepayment',amount:amount(target)}]}
    : target===price ? {payment_id:payment.id,amount:amount(target)}
    : {payment_id:payment.id,amount:amount(target),receipt:{customer:receipt.customer,items:[item]}}
  // Persist under the same order lock with version CAS, command ID uniqueness,
  // immutable body and an idempotency key BEFORE allowing any provider request.
  return {commandId:command.id,expectedVersion:ledger.version,
    kind:settle?'settlement':mode==='full_payment'?'refund_after':'refund_before',
    amountMinor:Number(target),quantity:item.quantity,body,expectedItems:[item]}
}
