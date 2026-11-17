import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {it,expect,vi} from 'vitest'
import TariffSupportEnd from './TariffSupportEnd'
const preview={version_id:'old',can_schedule:true,assigned_organizations:3,minimum_support_ends_at:'2098-01-01T00:00:00Z',notice_days:30}
function client(){return {rpc:vi.fn(),auth:{mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValue({})}}}}
it('previews subscriptions, confirms with MFA and refreshes after scheduling',async()=>{
 const c=client();c.rpc.mockResolvedValueOnce({data:preview}).mockResolvedValueOnce({data:{}}).mockResolvedValueOnce({data:{...preview,can_schedule:false,support_ends_at:'2099-01-01T00:00:00Z'}})
 render(<TariffSupportEnd client={c} versionId="old"/>);fireEvent.click(screen.getByText('Проверить связанные подписки'))
 await screen.findByText('Организаций с этой версией: 3.')
 fireEvent.change(screen.getByLabelText('Дата окончания поддержки'),{target:{value:'2099-01-01T12:00'}})
 fireEvent.click(screen.getByText('Назначить окончание поддержки…'));await screen.findByLabelText('Новый код MFA')
 fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}});fireEvent.click(screen.getByText('Подтвердить окончание поддержки'))
 await screen.findByText(/Окончание поддержки:/)
 expect(c.rpc.mock.calls[1][0]).toBe('schedule_tariff_support_end')
 expect(c.rpc.mock.calls[1][1]).toMatchObject({p_version_id:'old',p_expected_count:3})
 expect(screen.queryByLabelText('Дата окончания поддержки')).toBeNull()
})
it('does not schedule on preview or invalid date',async()=>{
 const c=client();c.rpc.mockResolvedValue({data:preview});render(<TariffSupportEnd client={c} versionId="old"/>);fireEvent.click(screen.getByText('Проверить связанные подписки'));await screen.findByLabelText('Дата окончания поддержки')
 fireEvent.click(screen.getByText('Назначить окончание поддержки…'));expect(screen.getByRole('alert')).toHaveTextContent('30 дней');expect(c.rpc).toHaveBeenCalledTimes(1);expect(c.auth.mfa.listFactors).not.toHaveBeenCalled()
})
it('hides preview after denied refresh',async()=>{
 const c=client();c.rpc.mockResolvedValueOnce({data:preview}).mockResolvedValueOnce({error:{code:'42501'}});render(<TariffSupportEnd client={c} versionId="old"/>);fireEvent.click(screen.getByText('Проверить связанные подписки'));await screen.findByLabelText('Дата окончания поддержки');fireEvent.click(screen.getByText('Проверить связанные подписки'));await waitFor(()=>expect(screen.queryByLabelText('Дата окончания поддержки')).toBeNull());await screen.findByRole('alert')
})
