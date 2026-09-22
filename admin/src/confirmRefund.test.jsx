import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import ConfirmRefund from './ConfirmRefund'
test('неопределённый ответ восстанавливается после открытия формы без второго резерва',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}}),mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValue({})}}}
 const api={confirmRefund:vi.fn().mockResolvedValue({refund_id:'refund'}),executeRefund:vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({state:'succeeded'})}
 const props={client,api,organizationId:'org',orderId:'order',amount:250}
 const view=render(<ConfirmRefund {...props}/>)
 fireEvent.click(screen.getByText('Подготовить подтверждение возврата'))
 await screen.findByLabelText('Новый код MFA')
 fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}})
 fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))
 await screen.findByText(/Результат не подтверждён/)
 const command=api.confirmRefund.mock.calls[0][4]
 expect(command).toBeTruthy()
 view.unmount()
 render(<ConfirmRefund {...props} amount={900}/>)
 fireEvent.click(screen.getByText('Подготовить подтверждение возврата'))
 await screen.findByText(/Сумма: 2,50/)
 fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'654321'}})
 fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))
 await screen.findByText('Возврат выполнен.')
 expect(api.confirmRefund).toHaveBeenCalledTimes(1)
 expect(api.executeRefund.mock.calls).toEqual([['refund'],['refund']])
 await waitFor(()=>expect(screen.queryByText('Повторить сохранённую операцию')).toBeNull())
 sessionStorage.clear()
})

test('восстановленный серверный резерв не требует локальной команды',async()=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}}),mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValue({})}}}
 const api={confirmRefund:vi.fn(),executeRefund:vi.fn().mockResolvedValue({state:'succeeded'})}
 render(<ConfirmRefund client={client} api={api} organizationId="org" orderId="order" amount={250} recovered={{refundId:'existing',amount:250,reason:'customer_request'}}/>)
 fireEvent.click(screen.getByText('Подготовить подтверждение возврата'))
 await screen.findByLabelText('Новый код MFA')
 fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}})
 fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))
 await screen.findByText('Возврат выполнен.')
 expect(api.confirmRefund).not.toHaveBeenCalled()
 expect(api.executeRefund).toHaveBeenCalledWith('existing')
})

test.each(['invalid refund amount','refund command conflict','network'])('отказ резервирования: %s',async message=>{
 sessionStorage.clear()
 const client={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner'}}}),mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValue({})}}}
 const api={confirmRefund:vi.fn().mockRejectedValue({code:message==='network'?undefined:'22023',message}),executeRefund:vi.fn()}
 const onNewPreview=vi.fn()
 render(<ConfirmRefund client={client} api={api} organizationId="org" orderId="order" amount={250} onNewPreview={onNewPreview}/>)
 fireEvent.click(screen.getByText('Подготовить подтверждение возврата'))
 await screen.findByLabelText('Новый код MFA')
 fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}})
 fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))
 await screen.findByRole('alert')
 expect(api.executeRefund).not.toHaveBeenCalled()
 if(message==='invalid refund amount'){
  fireEvent.click(screen.getByText('Перейти к новому расчёту'))
  expect(onNewPreview).toHaveBeenCalledTimes(1)
  expect(sessionStorage.length).toBe(0)
 }else{
  expect(screen.queryByText('Перейти к новому расчёту')).toBeNull()
  expect(sessionStorage.length).toBe(1)
 }
 sessionStorage.clear()
})
