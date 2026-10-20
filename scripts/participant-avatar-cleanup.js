// Test infrastructure only. A failed ownership check must never reach removal.
export function ownedCleanupStep(name, verify, remove) {
  return { name, run: async () => { await verify(); await remove() } }
}

export async function finishOwnedTest({ steps, receipt, writeReceipt, primaryError }) {
  const failures = []
  receipt.cleanupSteps = []
  for (const step of steps) {
    try {
      await step.run()
      receipt.cleanupSteps.push({ name: step.name, ok: true })
    } catch (error) {
      failures.push(new Error(`Cleanup failed: ${step.name}`, { cause: error }))
      // Record resource identity/stage, not arbitrary error text that might contain credentials.
      receipt.cleanupSteps.push({ name: step.name, ok: false })
    }
  }
  receipt.cleanup = failures.length === 0
  receipt.testFailed = Boolean(primaryError)
  receipt.completed = new Date().toISOString()
  try {
    await writeReceipt(receipt)
  } catch (error) {
    receipt.cleanup = false
    failures.push(new Error('Cleanup receipt write failed', { cause: error }))
  }
  if (failures.length) {
    throw new AggregateError(primaryError ? [primaryError, ...failures] : failures,
      primaryError ? 'Test failed and cleanup was incomplete' : 'Cleanup was incomplete',
      primaryError ? { cause: primaryError } : undefined)
  }
  if (primaryError) throw primaryError
}
