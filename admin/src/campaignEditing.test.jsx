import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import CampaignEditor from './CampaignEditor'
import ApproveCampaign from './ApproveCampaign'
const draft={id:'campaign',title:'Акция',revision:2,plan_key:'pro',discount_bps:5000,eligible_periods:2,period_months:1,activate_before:'2099-10-01T12:00:00Z'}
test('сохранение после сетевого сбоя повторяет команду и блокирует изменение условий',async()=>{
 const api={saveCampaign:vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({...draft,revision:3})},saved=vi.fn()
 render(<CampaignEditor api={api} organizationId="org" draft={draft} onSaved={saved}/>)
 fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Новая акция'}})
 fireEvent.click(screen.getByText('Сохранить черновик акции'))
 await screen.findByRole('alert')
 expect(screen.getByLabelText('Название').closest('fieldset').disabled).toBe(true)
 fireEvent.click(screen.getByText('Повторить сохранение'))
 await waitFor(()=>expect(saved).toHaveBeenCalled())
 expect(api.saveCampaign.mock.calls[1][0]).toEqual(api.saveCampaign.mock.calls[0][0])
 expect(api.saveCampaign.mock.calls[0][0]).toMatchObject({p_title:'Новая акция',p_expected_revision:2,p_organization_id:'org',p_discount_bps:5000})
})
test('ошибка MFA не отправляет утверждение, сетевой повтор сохраняет команду и редакцию',async()=>{
 const client={auth:{mfa:{listFactors:vi.fn().mockResolvedValue({data:{totp:[{id:'factor',status:'verified'}]}}),challengeAndVerify:vi.fn().mockResolvedValueOnce({error:Error('invalid')}).mockResolvedValue({error:null})}}}
 const api={approveCampaign:vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({...draft,state:'approved'})},approved=vi.fn()
 render(<ApproveCampaign api={api} client={client} draft={draft} onApproved={approved}/>)
 fireEvent.click(screen.getByText('Утвердить акцию…'))
 await screen.findByLabelText('Новый код MFA')
 const submit=()=>{fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}});fireEvent.click(screen.getByText('Подтвердить утверждение акции'))}
 submit();await screen.findByText('Код не принят. Введите новый код MFA.')
 expect(api.approveCampaign).not.toHaveBeenCalled()
 submit();await screen.findByText('Результат не подтверждён. Повтор использует ту же команду утверждения.')
 await waitFor(()=>expect(screen.getByText('Подтвердить утверждение акции').closest('fieldset').disabled).toBe(false))
 submit();await waitFor(()=>expect(approved).toHaveBeenCalled())
 expect(api.approveCampaign.mock.calls[1]).toEqual(api.approveCampaign.mock.calls[0])
 expect(api.approveCampaign.mock.calls[0].slice(0,2)).toEqual(['campaign',2])
})
