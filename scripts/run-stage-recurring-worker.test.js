// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runStageRecurringWorker } from './run-stage-recurring-worker.mjs'
const token = 'ab'.repeat(32)
const result = { processed: 1, failed: 0, reconciliationRequired: 0, reviewRequired: 0 }
it('calls stage once without redirects and only returns counters', async () => {
 const fetcher = vi.fn().mockResolvedValue(Response.json({ ...result, privateData: 'excluded' }))
 expect(await runStageRecurringWorker(token, fetcher)).toEqual(result)
 expect(fetcher).toHaveBeenCalledTimes(1)
 expect(fetcher).toHaveBeenCalledWith('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-recurring', expect.objectContaining({ method: 'POST', redirect: 'error', headers: { 'x-qvesta-worker-token': token } }))
})
it('rejects missing token before HTTP', async () => {
 const fetcher = vi.fn()
 await expect(runStageRecurringWorker('', fetcher)).rejects.toThrow()
 expect(fetcher).not.toHaveBeenCalled()
})
it.each([401, 503])('does not retry HTTP %s', async status => {
 const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }))
 await expect(runStageRecurringWorker(token, fetcher)).rejects.toThrow('worker_http_failure')
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['failed','reconciliationRequired','reviewRequired'])('reports %s', async key => {
 await expect(runStageRecurringWorker(token, async () => Response.json({ ...result, [key]: 1 }))).rejects.toThrow('worker_requires_attention')
})
it.each([{}, { ...result, processed: -1 }, { ...result, processed: 11 }, { ...result, failed: 0.5 }])('rejects malformed counters', async data => {
 await expect(runStageRecurringWorker(token, async () => Response.json(data))).rejects.toThrow('worker_invalid_response')
})
it('does not retry an unknown network result', async () => {
 const fetcher = vi.fn().mockRejectedValue(new Error('network'))
 await expect(runStageRecurringWorker(token, fetcher)).rejects.toThrow()
 expect(fetcher).toHaveBeenCalledTimes(1)
})