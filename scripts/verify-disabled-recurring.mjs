import { pathToFileURL } from 'node:url'
const stage = 'jeugfyaqzfgdvfhdxfht'
export async function verifyDisabledRecurring({ projectId, token, fetchImpl = fetch }) {
  if (projectId !== stage || !/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Invalid smoke configuration')
  const url = `https://${stage}.supabase.co/functions/v1/sandbox-recurring`
  for (const [method, headers, expected] of [
    ['GET', {}, 405], ['POST', {}, 401],
    ['POST', { 'x-qvesta-worker-token': token }, 503],
  ]) {
    const response = await fetchImpl(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (response.status !== expected || response.headers.get('cache-control') !== 'no-store' || (await response.text()) !== '') {
      throw new Error('Disabled recurring smoke failed')
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyDisabledRecurring({ projectId: process.env.SUPABASE_PROJECT_ID, token: process.env.YOOKASSA_SANDBOX_WORKER_TOKEN })
    console.log('Disabled recurring smoke PASS: GET 405, unauthorized POST 401, authorized POST 503; empty, no-store')
  } catch {
    console.error('Disabled recurring smoke failed; no response details logged')
    process.exitCode = 1
  }
}
