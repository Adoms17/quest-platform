// @vitest-environment node
// Failure injection is entirely synthetic: no actual containers are left behind.
import { test, expect, vi } from 'vitest'
import { finishOwnedTest, ownedCleanupStep } from './participant-avatar-cleanup.js'

test('browser close failure still closes server, removes verified containers/network and writes receipt', async () => {
  const calls = [], receipt = {}, primary = new Error('original test failure')
  const step = name => ({ name, run: async () => { calls.push(name) } })
  const writeReceipt = vi.fn(async value => { calls.push('receipt'); expect(value.cleanup).toBe(false) })
  let result
  try {
    await finishOwnedTest({ primaryError: primary, receipt, writeReceipt, steps: [
      { name: 'browser', run: async () => { calls.push('browser'); throw Error('injected close failure') } },
      step('server'), ownedCleanupStep('container', () => calls.push('inspect'), () => calls.push('remove')),
      step('network'),
    ] })
  } catch (error) { result = error }
  expect(calls).toEqual(['browser', 'server', 'inspect', 'remove', 'network', 'receipt'])
  expect(result).toBeInstanceOf(AggregateError); expect(result.cause).toBe(primary)
  expect(result.errors[0]).toBe(primary); expect(result.errors).toHaveLength(2)
  expect(receipt.cleanupSteps.map(x => x.ok)).toEqual([false, true, true, true])
  expect(writeReceipt).toHaveBeenCalledOnce()
})

test('unknown ownership prevents that removal while later verified resources are cleaned', async () => {
  const unknownRemove = vi.fn(), knownRemove = vi.fn(), writeReceipt = vi.fn(), receipt = {}
  await expect(finishOwnedTest({ receipt, writeReceipt, steps: [
    ownedCleanupStep('unknown', () => { throw Error('owner mismatch') }, unknownRemove),
    ownedCleanupStep('known', () => {}, knownRemove),
  ] })).rejects.toBeInstanceOf(AggregateError)
  expect(unknownRemove).not.toHaveBeenCalled(); expect(knownRemove).toHaveBeenCalledOnce()
  expect(writeReceipt).toHaveBeenCalledOnce(); expect(receipt.cleanup).toBe(false)
})

test('removal failure does not prevent remaining checks and receipt records both failures', async () => {
  const last = vi.fn(), writeReceipt = vi.fn(), receipt = {}
  await expect(finishOwnedTest({ receipt, writeReceipt, steps: [
    ownedCleanupStep('first', () => {}, () => { throw Error('injected rm failure') }),
    ownedCleanupStep('second', () => {}, last),
    ownedCleanupStep('network', () => { throw Error('still occupied') }, () => { throw Error('must not run') }),
  ] })).rejects.toBeInstanceOf(AggregateError)
  expect(last).toHaveBeenCalledOnce(); expect(receipt.cleanupSteps.map(x => x.ok)).toEqual([false, true, false])
  expect(writeReceipt).toHaveBeenCalledOnce()
})

test('receipt write failure preserves original error and reports persistence failure', async () => {
  const primary = new Error('original'), remove = vi.fn(), receipt = {}
  let result
  try { await finishOwnedTest({ primaryError: primary, receipt, steps: [{ name: 'resource', run: remove }], writeReceipt: () => { throw Error('disk failure') } }) }
  catch (error) { result = error }
  expect(remove).toHaveBeenCalledOnce(); expect(result.cause).toBe(primary)
  expect(result.errors[0]).toBe(primary); expect(result.errors[1].message).toBe('Cleanup receipt write failed')
})

test('successful cleanup writes receipt and rethrows original failure unchanged', async () => {
  const primary = new Error('original'), receipt = {}, writeReceipt = vi.fn()
  await expect(finishOwnedTest({ primaryError: primary, receipt, writeReceipt, steps: [] })).rejects.toBe(primary)
  expect(receipt.cleanup).toBe(true); expect(receipt.testFailed).toBe(true); expect(writeReceipt).toHaveBeenCalledOnce()
})

test('successful test and cleanup resolve with complete receipt', async () => {
  const receipt = { pass: true }, writeReceipt = vi.fn()
  await finishOwnedTest({ receipt, writeReceipt, steps: [{ name: 'resource', run: () => {} }] })
  expect(receipt.cleanup).toBe(true); expect(receipt.testFailed).toBe(false)
  expect(receipt.cleanupSteps).toEqual([{ name: 'resource', ok: true }]); expect(writeReceipt).toHaveBeenCalledOnce()
})
