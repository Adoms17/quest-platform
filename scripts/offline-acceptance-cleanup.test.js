// @vitest-environment node
import {test, expect, vi} from 'vitest'
import {removeOwnedResource, runAcceptanceCleanup} from './offline-acceptance-cleanup.js'

test('rejected and hung closes do not skip owned resources or receipt; original failure survives', async () => {
  const primary = new Error('original assertion')
  const removed = []
  const docker = async args => {
    if (args.includes('inspect')) return JSON.stringify([{Id: args.at(-1), Config: {Labels: {'qvesta.test.owner': 'test'}}, Labels: {'qvesta.test.owner': 'test'}}])
    removed.push(args.at(-1))
  }
  const receipt = vi.fn()
  const evidence = {cleanup: []}
  const result = runAcceptanceCleanup({primaryError: primary, timeoutMs: 10, evidence, writeReceipt: receipt, steps: [
    {name: 'vite', run: () => Promise.reject(new Error('injected close rejection'))},
    {name: 'proxy', run: () => new Promise(() => {})},
    ...['db', 'auth', 'rest', 'net'].map(id => ({name: id, run: () => removeOwnedResource(docker, 'test', id, id === 'net')})),
  ]})
  await expect(result).rejects.toMatchObject({cause: primary, errors: expect.arrayContaining([primary])})
  expect(removed).toEqual(['db', 'auth', 'rest', 'net'])
  expect(receipt).toHaveBeenCalledOnce()
  expect(evidence.cleanupErrors).toEqual([{step: 'vite', code: 'FAILED'}, {step: 'proxy', code: 'TIMEOUT'}])
  expect(evidence.runFailed).toBe(true)
})

test('owner mismatch and removal failure preserve independent cleanup and receipt', async () => {
  const removed = []
  const docker = async args => {
    const id = args.at(-1)
    if (args.includes('inspect')) return JSON.stringify([{Id: id, Config: {Labels: {'qvesta.test.owner': id === 'foreign' ? 'other' : 'test'}}, Labels: {'qvesta.test.owner': 'test'}}])
    if (id === 'broken') throw new Error('injected Docker failure')
    removed.push(id)
  }
  const evidence = {cleanup: []}, receipt = vi.fn()
  await expect(runAcceptanceCleanup({evidence, writeReceipt: receipt, steps: ['foreign', 'broken', 'owned', 'net'].map(id => ({name: id, run: () => removeOwnedResource(docker, 'test', id, id === 'net')}))})).rejects.toThrow(AggregateError)
  expect(removed).toEqual(['owned', 'net'])
  expect(evidence.cleanupErrors).toEqual([{step: 'foreign', code: 'OWNER_MISMATCH'}, {step: 'broken', code: 'FAILED'}])
  expect(receipt).toHaveBeenCalledOnce()
})

test('receipt failure retains original error after resource cleanup', async () => {
  const primary = new Error('original'), cleaned = vi.fn()
  await expect(runAcceptanceCleanup({primaryError: primary, evidence: {cleanup: []}, steps: [{name: 'resource', run: cleaned}], writeReceipt: () => {throw new Error('disk failure')}})).rejects.toMatchObject({cause: primary})
  expect(cleaned).toHaveBeenCalledOnce()
})

test('successful cleanup rethrows the exact original failure', async () => {
  const primary = new Error('original')
  await expect(runAcceptanceCleanup({primaryError: primary, evidence: {cleanup: []}, steps: [], writeReceipt: () => {}})).rejects.toBe(primary)
})
