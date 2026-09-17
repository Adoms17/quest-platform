// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runStageBillingWorker } from './run-stage-billing-worker.mjs'
const token = 'ab'.repeat(32)
const result = { checked: 1, applied: 1, review: 0, deferred: 0, failed: 0, refunds: { checked: 0, failed: 0 } }
it('вызывает только stage, запрещает redirect и возвращает только счётчики', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...result, privateField: 'not logged' }))
  const actual = await runStageBillingWorker(token, fetcher)
  expect(fetcher).toHaveBeenCalledWith('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-reconcile', expect.objectContaining({ method: 'POST', redirect: 'error', headers: { 'x-qvesta-worker-token': token } }))
  expect(actual).toEqual({ checked: 1, applied: 1, review: 0, deferred: 0, failed: 0, refundChecked: 0, refundFailed: 0 })
})
it('без корректного токена не делает запрос', async () => {
  const fetcher = vi.fn()
  await expect(runStageBillingWorker('', fetcher)).rejects.toThrow('worker_token_missing_or_invalid')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([401, 503])('HTTP %s завершает проверку ошибкой', async status => {
  await expect(runStageBillingWorker(token, async () => new Response(null, { status }))).rejects.toThrow('worker_http_failure')
})
it.each([{ ...result, failed: 1 }, { ...result, review: 1 }, { ...result, refunds: { checked: 1, failed: 1 } }])('не скрывает ошибку обработки или необходимость проверки', async data => {
  await expect(runStageBillingWorker(token, async () => Response.json(data))).rejects.toThrow('worker_requires_attention')
})
it.each([{}, { ...result, checked: -1 }, { ...result, refunds: {} }])('отклоняет неполный или некорректный ответ', async data => {
  await expect(runStageBillingWorker(token, async () => Response.json(data))).rejects.toThrow('worker_invalid_response')
})
