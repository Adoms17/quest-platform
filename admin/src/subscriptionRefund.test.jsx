import {createSubscriptionRefundApi} from './subscriptionRefundApi'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import SubscriptionRefund from './SubscriptionRefund'

test('calculation does not reserve, lost send resumes the same refund after remount',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}})),mfa:{listFactors:vi.fn(async()=>({data:{totp:[{id:'factor',status:'verified'}]}})),challengeAndVerify:vi.fn(async()=>({}))}}}
 const api={requestSubscriptionRefund:vi.fn(async()=>({request_id:'request',amount_minor:200,period_start:'2026-09-01',period_end:'2026-10-01'})),reserveSubscriptionRefund:vi.fn(async()=>({refund_id:'refund'})),executeSubscriptionRefund:vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue({state:'succeeded',accessEffect:'applied'})}
 const props={client,api,organizationId:'org',orderId:'order'}
 function submit(confirm=false){
  if(confirm)fireEvent.click(screen.getByRole('checkbox'))
  if(screen.queryByLabelText('Источник обращения'))fireEvent.change(screen.getByLabelText('Источник обращения'),{target:{value:'inapp'}});const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))
 }
 const view=render(<SubscriptionRefund {...props}/>);submit()
 await screen.findByText(/К возврату: 2,00/)
 expect(api.reserveSubscriptionRefund).not.toHaveBeenCalled()
 submit(true);await screen.findByRole('alert')
 view.unmount();render(<SubscriptionRefund {...props}/>);submit()
 await screen.findByText(/К возврату: 2,00/);submit(true)
 await screen.findByText('Возврат выполнен, возвращаемый период прекращён.')
 expect(api.reserveSubscriptionRefund).toHaveBeenCalledTimes(1)
 expect(api.executeSubscriptionRefund.mock.calls).toEqual([['refund'],['refund']])
 expect(api.requestSubscriptionRefund.mock.calls[0]).toEqual(api.requestSubscriptionRefund.mock.calls[1])
 sessionStorage.clear()
})

 test.each(['storage','reservation'])('failure in %s prevents send and retains recoverable operation',async failure=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}})),mfa:{listFactors:vi.fn(async()=>({data:{totp:[{id:'factor',status:'verified'}]}})),challengeAndVerify:vi.fn(async()=>({}))}}}
 const api={requestSubscriptionRefund:vi.fn(async()=>({request_id:'request',amount_minor:200,period_start:'2026-09-01',period_end:'2026-10-01'})),reserveSubscriptionRefund:vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue({refund_id:'refund'}),executeSubscriptionRefund:vi.fn(async()=>({state:'succeeded',accessEffect:'applied'}))}
 const view=render(<SubscriptionRefund client={client} api={api} organizationId="org" orderId="order"/> )
 const submit=()=>{if(screen.queryByLabelText('Источник обращения'))fireEvent.change(screen.getByLabelText('Источник обращения'),{target:{value:'inapp'}});const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 const spy=failure==='storage'?vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')}):null
 try {
  submit()
  if(failure==='storage'){
   await screen.findByRole('alert');expect(api.requestSubscriptionRefund).not.toHaveBeenCalled()
  }else{
   await screen.findByText(/К возврату: 2,00/);fireEvent.click(screen.getByRole('checkbox'));submit()
   await screen.findByRole('alert');expect(api.executeSubscriptionRefund).not.toHaveBeenCalled()
   fireEvent.click(screen.getByRole('checkbox'));submit()
   await screen.findByText('Возврат выполнен, возвращаемый период прекращён.')
   expect(api.reserveSubscriptionRefund.mock.calls).toEqual([['org','order','request',false],['org','order','request',false]])
  }
 }finally{spy?.mockRestore();view.unmount();sessionStorage.clear()}
})

 test('fiscal receipt delay keeps the same operation available for status checks',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}})),mfa:{listFactors:vi.fn(async()=>({data:{totp:[{id:'factor',status:'verified'}]}})),challengeAndVerify:vi.fn(async()=>({}))}}}
 const api={subscriptionFiscalRefundsEnabled:true,requestSubscriptionRefund:vi.fn(async()=>({request_id:'request',amount_minor:200,period_start:'2026-09-01',period_end:'2026-10-01'})),reserveSubscriptionRefund:vi.fn(async()=>({refund_id:'refund',fiscal_command_id:'request'})),executeSubscriptionRefund:vi.fn().mockResolvedValueOnce({commandId:'request',state:'succeeded',receiptStatus:'unknown',accessEffect:'applied',requiresReview:false}).mockResolvedValue({commandId:'request',state:'succeeded',receiptStatus:'succeeded',accessEffect:'applied',requiresReview:false})}
 const view=render(<SubscriptionRefund client={client} api={api} organizationId="org" orderId="order"/> )
 const submit=()=>{if(screen.queryByLabelText('Источник обращения'))fireEvent.change(screen.getByLabelText('Источник обращения'),{target:{value:'inapp'}});const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 submit();await screen.findByText(/К возврату: 2,00/);fireEvent.click(screen.getByRole('checkbox'));submit()
 await screen.findByText('Деньги возвращены.');expect(screen.getByText('Ожидается подтверждение чека возврата.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Проверить состояние возврата'})).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull()
 submit();await screen.findByText('Чек возврата подтверждён.')
 expect(api.executeSubscriptionRefund.mock.calls).toEqual([['refund','request'],['refund','request']])
 expect(api.reserveSubscriptionRefund).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button')).toBeNull()
 view.unmount();sessionStorage.clear()
})

test('email received time survives unknown registration response and changed retry is explicit',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}})),mfa:{listFactors:vi.fn(async()=>({data:{totp:[{id:'factor',status:'verified'}]}})),challengeAndVerify:vi.fn(async()=>({}))}}}
 const api={requestSubscriptionRefund:vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue({request_id:'request',amount_minor:200,period_start:'2026-09-01',period_end:'2026-10-01'}),reserveSubscriptionRefund:vi.fn(),executeSubscriptionRefund:vi.fn()}
 const props={client,api,organizationId:'email-org',orderId:'email-order'}
 const submit=()=>{const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 const view=render(<SubscriptionRefund {...props}/>);fireEvent.change(screen.getByLabelText('Время получения письма'),{target:{value:'2026-09-16T12:00:00'}});submit();await screen.findByRole('alert')
 expect(api.requestSubscriptionRefund.mock.calls[0][3]).toEqual({source:'email',receivedAt:new Date(2026,8,16,12).toISOString()})
 fireEvent.change(screen.getByLabelText('Время получения письма'),{target:{value:'2026-09-17T12:00:00'}});submit();await screen.findByText(/Время или источник отличаются/)
 expect(api.requestSubscriptionRefund).toHaveBeenCalledTimes(1)
 view.unmount();const retry=render(<SubscriptionRefund {...props}/>);submit();await screen.findByText(/К возврату: 2,00/)
 expect(api.requestSubscriptionRefund.mock.calls[0]).toEqual(api.requestSubscriptionRefund.mock.calls[1])
 expect(api.reserveSubscriptionRefund).not.toHaveBeenCalled();expect(api.executeSubscriptionRefund).not.toHaveBeenCalled();retry.unmount();sessionStorage.clear()
})

test('confirmed invalid receipt permits a corrected new command without reserving money',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}}),mfa:{listFactors:async()=>({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:async()=>({})}}}
 const failure=Object.assign(Error('invalid_receipt_time'),{definitiveReceiptRejection:true})
 const api={requestSubscriptionRefund:vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({request_id:'request',amount_minor:200,period_start:'2026-09-01',period_end:'2026-10-01'}),reserveSubscriptionRefund:vi.fn(),executeSubscriptionRefund:vi.fn()}
 const view=render(<SubscriptionRefund client={client} api={api} organizationId="correct-org" orderId="correct-order"/>)
 const submit=()=>{const input=view.container.querySelector('[name="code"]');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 fireEvent.change(view.container.querySelector('[name="receivedAt"]'),{target:{value:'2027-09-16T12:00'}});submit();await screen.findByRole('alert')
 expect(sessionStorage.getItem('qvesta-subscription-refund:owner:correct-org:correct-order')).toBeNull()
 fireEvent.change(view.container.querySelector('[name="receivedAt"]'),{target:{value:'2026-09-16T12:00'}});submit()
 await vi.waitFor(()=>expect(api.requestSubscriptionRefund).toHaveBeenCalledTimes(2))
 expect(api.requestSubscriptionRefund.mock.calls[0][2]).not.toBe(api.requestSubscriptionRefund.mock.calls[1][2])
 expect(api.reserveSubscriptionRefund).not.toHaveBeenCalled();expect(api.executeSubscriptionRefund).not.toHaveBeenCalled()
 view.unmount();sessionStorage.clear()
})

test('fresh session restores unknown-time legacy quote and continues existing reservation',async()=>{
 sessionStorage.clear()
 const functions={invoke:vi.fn(async(_name,{body})=>({data:body.action==='request'?{request_id:'legacy-request',amount_minor:417,currency:'RUB',period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z',requested_at:'2026-09-18T00:00:00Z',registered_at:'2026-09-18T00:00:00Z',received_at:null,receipt_source:null,policy:'subscription-prorata-v1',reserved:false,access_effect:'unchanged'}:body.action==='reserve'?{request_id:'legacy-request',refund_id:'existing-refund'}:{refundId:'existing-refund',state:'succeeded',accessEffect:'applied'}}))}
 const client={functions,auth:{getUser:async()=>({data:{user:{id:'owner'}}}),mfa:{listFactors:async()=>({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:async()=>({})}}}
 const api=createSubscriptionRefundApi(client)
 const view=render(<SubscriptionRefund client={client} api={api} organizationId="legacy-org" orderId="legacy-order"/>)
 fireEvent.change(view.container.querySelector('[name="receiptSource"]'),{target:{value:'inapp'}})
 const submit=()=>{const input=view.container.querySelector('[name="code"]');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 submit();await screen.findByText(/Время получения обращения неизвестно/)
 expect(functions.invoke).toHaveBeenCalledTimes(1)
 expect(functions.invoke.mock.calls[0][1].body).toMatchObject({action:'request',receiptSource:'inapp',receivedAt:null})
 expect(view.container.textContent).toContain('4,17')
 fireEvent.click(screen.getByRole('checkbox'));submit()
 await vi.waitFor(()=>expect(functions.invoke).toHaveBeenCalledTimes(3))
 expect(functions.invoke.mock.calls[1][1].body).toEqual({action:'reserve',organizationId:'legacy-org',orderId:'legacy-order',requestId:'legacy-request'})
 expect(functions.invoke.mock.calls[2][1].body).toEqual({refundId:'existing-refund'})
 view.unmount();sessionStorage.clear()
})
