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
  const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))
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
 const submit=()=>{const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
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
 const submit=()=>{const input=screen.getByLabelText('Код MFA для возврата подписки');fireEvent.change(input,{target:{value:'123456'}});fireEvent.submit(input.closest('form'))}
 submit();await screen.findByText(/К возврату: 2,00/);fireEvent.click(screen.getByRole('checkbox'));submit()
 await screen.findByText('Деньги возвращены.');expect(screen.getByText('Ожидается подтверждение чека возврата.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Проверить состояние возврата'})).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull()
 submit();await screen.findByText('Чек возврата подтверждён.')
 expect(api.executeSubscriptionRefund.mock.calls).toEqual([['refund','request'],['refund','request']])
 expect(api.reserveSubscriptionRefund).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button')).toBeNull()
 view.unmount();sessionStorage.clear()
})
