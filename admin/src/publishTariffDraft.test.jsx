import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import PublishTariffDraft from './PublishTariffDraft'
function client() { return { rpc: vi.fn(), auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ id: 'factor', status: 'verified' }] } }), challengeAndVerify: vi.fn().mockResolvedValue({}) } } } }
async function confirm(label='Подтвердить публикацию') { await screen.findByLabelText('Новый код MFA');fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}});fireEvent.click(screen.getByText(label)) }
it('publishes saved revision with future date and reuses command after lost response',async()=>{
 const c=client();c.rpc.mockResolvedValueOnce({error:{code:'network'}}).mockResolvedValueOnce({data:{version_id:'v',number_at_publication:2,effective_at:'2099-01-02T12:00:00Z'}})
 render(<PublishTariffDraft client={c} draft={{id:'draft',revision:3}} />)
 fireEvent.change(screen.getByLabelText('Дата и время вступления в силу'),{target:{value:'2099-01-02T12:00'}})
 fireEvent.click(screen.getByText('Опубликовать версию…'));await confirm();await screen.findByRole('alert')
 expect(screen.getByLabelText('Дата и время вступления в силу').disabled).toBe(true)
 await confirm();await screen.findByText(/Версия №2 опубликована/)
 expect(c.rpc.mock.calls[0]).toEqual(c.rpc.mock.calls[1])
 expect(c.rpc.mock.calls[0][0]).toBe('publish_tariff_draft')
 expect(c.rpc.mock.calls[0][1]).toMatchObject({p_draft_id:'draft',p_expected_revision:3})
 c.rpc.mockResolvedValue({data:{version_id:'v'}})
 fireEvent.click(screen.getByText('Отозвать публикацию…'));await confirm('Подтвердить отзыв');await screen.findByText(/Публикация отозвана/)
 expect(c.rpc.mock.calls[2][0]).toBe('revoke_tariff_publication')
 expect(c.rpc.mock.calls[2][1].p_command_id).not.toBe(c.rpc.mock.calls[0][1].p_command_id)
})
it('does not publish without future date',()=>{
 const c=client();render(<PublishTariffDraft client={c} draft={{id:'draft',revision:1}} />)
 fireEvent.click(screen.getByText('Опубликовать версию…'))
 expect(screen.getByRole('alert')).toHaveTextContent('будущую дату')
 expect(c.auth.mfa.listFactors).not.toHaveBeenCalled();expect(c.rpc).not.toHaveBeenCalled()
})
it('does not publish after rejected MFA',async()=>{
 const c=client();c.auth.mfa.challengeAndVerify.mockResolvedValue({error:{}})
 render(<PublishTariffDraft client={c} draft={{id:'draft',revision:1}} />)
 fireEvent.change(screen.getByLabelText('Дата и время вступления в силу'),{target:{value:'2099-01-02T12:00'}})
 fireEvent.click(screen.getByText('Опубликовать версию…'));await confirm();await screen.findByRole('alert')
 expect(c.rpc).not.toHaveBeenCalled()
})

it('notifies parent after successful revocation to refresh server state',async()=>{
 const c=client(),changed=vi.fn();c.rpc.mockResolvedValue({data:{version_id:'v'}});
 render(<PublishTariffDraft client={c} publication={{version_id:'v',number_at_publication:2,effective_at:'2099-01-02T12:00:00Z'}} onChanged={changed}/>);
 fireEvent.click(screen.getByText('Отозвать публикацию…'));await confirm('Подтвердить отзыв');await screen.findByText(/Публикация отозвана/);
 expect(changed).toHaveBeenCalledExactlyOnceWith({version_id:'v'});
});
