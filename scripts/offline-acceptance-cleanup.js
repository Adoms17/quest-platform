async function bounded(action, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Cleanup timeout'), {code: 'CLEANUP_TIMEOUT'})), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

export async function removeOwnedResource(docker, owner, id, network = false) {
  const info = JSON.parse(await docker(network ? ['network', 'inspect', id] : ['inspect', id]))[0]
  if (info.Id !== id || (network ? info.Labels : info.Config?.Labels)?.['qvesta.test.owner'] !== owner) {
    throw Object.assign(new Error('Cleanup ownership mismatch'), {code: 'OWNER_MISMATCH'})
  }
  await docker(network ? ['network', 'rm', id] : ['rm', '-fv', id])
}

// A failed/hung close cannot skip later resources or the final receipt. Error
// details are deliberately excluded from the receipt (they may contain tokens).
export async function runAcceptanceCleanup({steps, evidence, writeReceipt, primaryError, timeoutMs = 5000}) {
  const failures = []
  evidence.cleanupErrors = []
  for (const step of steps) {
    try {
      await bounded(step.run, step.timeoutMs ?? timeoutMs)
      evidence.cleanup.push({step: step.name, removed: true})
    } catch (error) {
      failures.push(error)
      evidence.cleanup.push({step: step.name, removed: false})
      evidence.cleanupErrors.push({step: step.name, code: error?.code === 'CLEANUP_TIMEOUT' ? 'TIMEOUT' : error?.code === 'OWNER_MISMATCH' ? 'OWNER_MISMATCH' : 'FAILED'})
    }
  }
  evidence.finishedAtUtc = new Date().toISOString()
  evidence.runFailed = Boolean(primaryError)
  try { await bounded(() => writeReceipt(evidence), timeoutMs) } catch (error) {
    failures.push(error)
    evidence.cleanupErrors.push({step: 'receipt', code: 'FAILED'})
  }
  if (failures.length) throw new AggregateError(primaryError ? [primaryError, ...failures] : failures, 'Acceptance cleanup failed; inspect cleanup receipt', {cause: primaryError})
  if (primaryError) throw primaryError
}
