// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { retrySubscriptionRefundAccess } from './subscriptionRefundAccessRetry.js'

test('retries only access and continues after one storage failure', async () => {
 const rpc = vi.fn().mockResolvedValueOnce({data:['a','b','c']})
  .mockResolvedValueOnce({error:{code:'failure'}})
  .mockResolvedValueOnce({data:{access_state:'review_required'}})
  .mockResolvedValueOnce({data:{access_state:'applied'}})
 expect(await retrySubscriptionRefundAccess({rpc,shopId:'123'})).toEqual({checked:3,review:1,failed:1})
 expect(rpc.mock.calls.slice(1).map(([name])=>name)).toEqual(Array(3).fill('retry_sandbox_subscription_refund_application'))
 expect(rpc).toHaveBeenLastCalledWith('retry_sandbox_subscription_refund_application',{p_shop_id:'123',p_refund_id:'c'})
})
test('empty queue does nothing', async () => {
 const rpc=vi.fn().mockResolvedValue({data:[]})
 expect(await retrySubscriptionRefundAccess({rpc,shopId:'123'})).toEqual({checked:0,review:0,failed:0})
 expect(rpc).toHaveBeenCalledTimes(1)
})
test('list failure is not reported as an empty queue', async () => {
 const rpc=vi.fn().mockResolvedValue({error:{code:'failure'}})
 await expect(retrySubscriptionRefundAccess({rpc,shopId:'123'})).rejects.toThrow('refund_access_storage_unavailable')
})
