import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import IssueCampaignCode from './IssueCampaignCode'
const campaign={id:'campaign',revision:2,discount_bps:10000,eligible_periods:2,period_months:1}
test('выпускает только после подтверждения и показывает код',async()=>{
 const api={issueCampaign:vi.fn().mockResolvedValue({discount_id:'discount',already_issued:false,code:'synthetic-code'})}
 render(<IssueCampaignCode api={api} organizationId="org" campaign={campaign}/>)
 fireEvent.click(screen.getByText('Выпустить промокод…'))
 expect(api.issueCampaign).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Подтвердить выпуск кода'))
 expect((await screen.findByLabelText('Промокод')).value).toBe('synthetic-code')
 expect(api.issueCampaign.mock.calls[0].slice(0,3)).toEqual(['org','campaign',2])
 expect(screen.queryByText('Подтвердить выпуск кода')).toBeNull()
})
test('неопределённый результат повторяется с той же командой без обещания восстановить код',async()=>{
 const api={issueCampaign:vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({discount_id:'discount',already_issued:true,code:null})},lock=vi.fn()
 render(<IssueCampaignCode api={api} organizationId="org" campaign={campaign} onLock={lock}/>)
 fireEvent.click(screen.getByText('Выпустить промокод…'));fireEvent.click(screen.getByText('Подтвердить выпуск кода'))
 await screen.findByRole('alert')
 expect(screen.getByText('Отмена выпуска').disabled).toBe(true)
 fireEvent.click(screen.getByText('Повторить запрос выпуска'))
 await screen.findByText(/Повторный код не создан/)
 expect(api.issueCampaign.mock.calls[1]).toEqual(api.issueCampaign.mock.calls[0])
 expect(screen.queryByLabelText('Промокод')).toBeNull()
 expect(lock).toHaveBeenLastCalledWith(false)
})
test('двойное нажатие не отправляет два запроса',async()=>{
 let resolve
 const api={issueCampaign:vi.fn(()=>new Promise(done=>{resolve=done}))}
 render(<IssueCampaignCode api={api} organizationId="org" campaign={campaign}/>)
 fireEvent.click(screen.getByText('Выпустить промокод…'));fireEvent.click(screen.getByText('Подтвердить выпуск кода'));fireEvent.click(screen.getByText('Повторить запрос выпуска'))
 expect(api.issueCampaign).toHaveBeenCalledTimes(1)
 resolve({discount_id:'discount',already_issued:true,code:null})
 await waitFor(()=>expect(screen.queryByText('Повторить запрос выпуска')).toBeNull())
})

test('сокращённый срок передаётся серверу и не может выходить за период акции',async()=>{
 const api={issueCampaign:vi.fn().mockResolvedValue({discount_id:'d',code:'synthetic',already_issued:false})}
 render(<IssueCampaignCode api={api} organizationId="org" campaign={{...campaign,starts_at:'2099-01-01T00:00:00Z',activate_before:'2099-02-01T00:00:00Z'}}/>)
 fireEvent.change(screen.getByLabelText('Срок активации'),{target:{value:'custom'}})
 fireEvent.change(screen.getByLabelText('Активировать до'),{target:{value:'2099-03-01T12:00'}})
 fireEvent.click(screen.getByText('Выпустить промокод…'));fireEvent.click(screen.getByText('Подтвердить выпуск кода'))
 await screen.findByRole('alert');expect(api.issueCampaign).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Отмена выпуска'))
 fireEvent.change(screen.getByLabelText('Активировать до'),{target:{value:'2099-01-15T12:00'}})
 fireEvent.click(screen.getByText('Выпустить промокод…'));fireEvent.click(screen.getByText('Подтвердить выпуск кода'))
 await screen.findByLabelText('Промокод')
 expect(api.issueCampaign.mock.calls[0][4]).toBe(new Date('2099-01-15T12:00').toISOString())
})
