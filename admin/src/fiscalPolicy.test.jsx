import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import FiscalPolicy from './FiscalPolicy'
import {createFiscalPolicyApi,fiscalPolicyId,fiscalPolicyStorageKey} from './fiscalPolicyApi'
const scopedKey=fiscalPolicyStorageKey+':account:synthetic-owner'
const date='2029-01-01T12:00'
const command={p_id:fiscalPolicyId,p_shop_id:'1467641',p_effective_at:new Date(date).toISOString()}
function setup(){
 const client={supabaseUrl:'https://jeugfyaqzfgdvfhdxfht.supabase.co',auth:{mfa:{listFactors:vi.fn(async()=>({data:{totp:[{id:'synthetic-factor',status:'verified'}]}})),challengeAndVerify:vi.fn(async()=>({error:null}))}},rpc:vi.fn(async(_name,args)=>({data:{id:args.p_id,shop_id:args.p_shop_id,effective_at:args.p_effective_at,environment:'sandbox',vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}}))}
 return client
}
beforeEach(()=>{localStorage.clear();vi.stubGlobal('location',{origin:'https://stage-admin.qvesta.ru'})})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function prepare(){fireEvent.change(screen.getByLabelText('Дата и время начала'),{target:{value:date}});fireEvent.click(screen.getByText('Перейти к подтверждению MFA'));await screen.findByLabelText('Новый код MFA')}
function submit(){fireEvent.change(screen.getByLabelText('Новый код MFA'),{target:{value:'123456'}});fireEvent.submit(screen.getByLabelText('Новый код MFA').closest('form'))}
it('confirms fresh MFA and saves exact command before RPC',async()=>{
 const c=setup();c.rpc.mockImplementation(async(_name,args)=>{expect(JSON.parse(localStorage.getItem(scopedKey))).toEqual(args);return {data:{id:args.p_id,shop_id:args.p_shop_id,effective_at:args.p_effective_at,environment:'sandbox',vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}}})
 render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();expect(c.rpc).not.toHaveBeenCalled();submit()
 await screen.findByText(/Политика сохранена/);expect(c.auth.mfa.challengeAndVerify).toHaveBeenCalledOnce();expect(c.rpc).toHaveBeenCalledWith('create_sandbox_subscription_fiscal_policy',command)
 expect(localStorage.getItem(scopedKey)).not.toContain('123456')
})
it('MFA failure blocks storage and RPC',async()=>{
 const c=setup();c.auth.mfa.challengeAndVerify.mockResolvedValue({error:{}});render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();submit()
 await screen.findByText('Код не принят. Введите новый код.');expect(c.rpc).not.toHaveBeenCalled();expect(localStorage.getItem(scopedKey)).toBeNull()
})
it('uncertain response survives remount and retry keeps the same ID and time',async()=>{
 const c=setup();c.rpc.mockRejectedValueOnce(Error('network'));const view=render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();submit()
 await screen.findByRole('alert');expect(c.rpc).toHaveBeenCalledTimes(1);view.unmount()
 render(<FiscalPolicy client={c} userId="synthetic-owner"/>);expect(screen.queryByLabelText('Дата и время начала')).toBeNull();fireEvent.click(screen.getByText('Перейти к подтверждению MFA'));await screen.findByLabelText('Новый код MFA');submit()
 await screen.findByText(/Политика сохранена/);expect(c.rpc.mock.calls[1]).toEqual(c.rpc.mock.calls[0])
})
it('storage failure blocks sending',async()=>{
 const c=setup();render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});submit();await screen.findByRole('alert');expect(c.rpc).not.toHaveBeenCalled()
})
it('invalid saved command blocks new preparation',()=>{
 localStorage.setItem(scopedKey,'invalid');const c=setup();render(<FiscalPolicy client={c} userId="synthetic-owner"/>);expect(screen.getByText('Перейти к подтверждению MFA')).toBeDisabled();expect(c.rpc).not.toHaveBeenCalled()
})
it('double submit cannot send twice',async()=>{
 const c=setup();render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();submit();submit();await screen.findByText(/Политика сохранена/);expect(c.rpc).toHaveBeenCalledOnce()
})
it.each(['origin','project'])('rejects wrong %s before RPC',async kind=>{
 const c=setup();if(kind==='origin')vi.stubGlobal('location',{origin:'https://admin.qvesta.ru'});else c.supabaseUrl='https://other.supabase.co'
 render(<FiscalPolicy client={c} userId="synthetic-owner"/>);expect(screen.queryByText('Тестовая фискальная политика')).toBeNull();await expect(createFiscalPolicyApi(c).create(command)).rejects.toThrow('stage_required');expect(c.rpc).not.toHaveBeenCalled()
})
it('rejects altered shop and unexpected server response',async()=>{
 const c=setup();await expect(createFiscalPolicyApi(c).create({...command,p_shop_id:'other'})).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled()
 c.rpc.mockResolvedValue({data:{id:fiscalPolicyId,shop_id:'other'}});await expect(createFiscalPolicyApi(c).create(command)).rejects.toThrow('unconfirmed_policy')
})
it('unmount during MFA stops the mutation',async()=>{
 const c=setup();let release;c.auth.mfa.challengeAndVerify.mockImplementation(()=>new Promise(resolve=>{release=resolve}));const view=render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();submit();view.unmount();release({error:null});await waitFor(()=>expect(c.rpc).not.toHaveBeenCalled())
})

it('switching accounts hides the previous command and restores it only for its owner',()=>{
 localStorage.setItem(scopedKey,JSON.stringify(command));const c=setup()
 const view=render(<FiscalPolicy client={c} userId="synthetic-owner"/>);
 expect(screen.queryByLabelText('Дата и время начала')).toBeNull()
 view.rerender(<FiscalPolicy client={c} userId="synthetic-other"/>);
 expect(screen.getByLabelText('Дата и время начала')).toHaveValue('')
 expect(screen.queryByText(/Сохранённая дата начала/)).toBeNull()
 view.rerender(<FiscalPolicy client={c} userId="synthetic-owner"/>);
 expect(screen.getByText(/Сохранённая дата начала/)).toBeInTheDocument()
 expect(localStorage.getItem(scopedKey)).toBe(JSON.stringify(command));expect(c.rpc).not.toHaveBeenCalled()
})
it('preserves unattributed legacy command without exposing or automatically adopting it',()=>{
 localStorage.setItem(fiscalPolicyStorageKey,JSON.stringify(command));const c=setup()
 render(<FiscalPolicy client={c} userId="synthetic-other"/>);
 expect(screen.getByText(/Найдена прежняя операция/)).toBeInTheDocument()
 expect(screen.queryByText(/Сохранённая дата начала/)).toBeNull()
 expect(screen.getByText('Перейти к подтверждению MFA')).toBeDisabled()
 expect(localStorage.getItem(fiscalPolicyStorageKey)).toBe(JSON.stringify(command));expect(c.rpc).not.toHaveBeenCalled()
})
it('missing account blocks preparation',()=>{
 const c=setup();render(<FiscalPolicy client={c}/>);
 expect(screen.getByText('Перейти к подтверждению MFA')).toBeDisabled();expect(c.rpc).not.toHaveBeenCalled()
})

it('switching accounts while MFA is pending prevents the old command from being sent',async()=>{
 const c=setup();let release
 c.auth.mfa.challengeAndVerify.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
 const view=render(<FiscalPolicy client={c} userId="synthetic-owner"/>);await prepare();submit()
 view.rerender(<FiscalPolicy client={c} userId="synthetic-other"/>);release({error:null})
 await waitFor(()=>expect(screen.getByLabelText('Дата и время начала')).toHaveValue(''))
 expect(c.rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0)
})
