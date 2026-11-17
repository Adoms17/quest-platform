import {it,expect,vi} from 'vitest'
import {createSubscriptionRefundApi} from './subscriptionRefundApi.js'
it('fiscal route is opt-in and saved fiscal IDs survive disabling the UI flag',async()=>{
 const invoke=vi.fn().mockResolvedValueOnce({data:{request_id:'request',refund_id:'refund',fiscal_command_id:'request'}})
 .mockResolvedValueOnce({data:{commandId:'request',refundId:'refund',state:'succeeded',receiptStatus:'unknown',requiresReview:false,accessEffect:'applied'}})
 const client={functions:{invoke}}
 await createSubscriptionRefundApi(client,{fiscalEnabled:true}).reserveSubscriptionRefund('org','order','request')
 await createSubscriptionRefundApi(client).executeSubscriptionRefund('refund','request')
 expect(invoke.mock.calls.map(c=>c[0])).toEqual(['admin-subscription-fiscal-refund','admin-subscription-fiscal-refund'])
 expect(invoke.mock.calls[1][1].body).toEqual({action:'execute',commandId:'request'})
})
it('a saved legacy operation does not migrate when the UI flag changes',async()=>{
 const invoke=vi.fn().mockResolvedValue({data:{request_id:'request',refund_id:'refund'}})
 await createSubscriptionRefundApi({functions:{invoke}},{fiscalEnabled:true}).reserveSubscriptionRefund('org','order','request',false)
 expect(invoke.mock.calls[0][0]).toBe('admin-subscription-refund-prepare')
})
it('does not accept another operation or missing fiscal status',async()=>{
 const invoke=vi.fn().mockResolvedValue({data:{commandId:'other',refundId:'refund',state:'succeeded',accessEffect:'applied'}})
 await expect(createSubscriptionRefundApi({functions:{invoke}}).executeSubscriptionRefund('refund','request')).rejects.toThrow('invalid_fiscal_result')
})
