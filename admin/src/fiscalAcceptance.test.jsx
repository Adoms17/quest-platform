import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import FiscalAcceptance from './FiscalAcceptance'
import {acceptanceFixtureId,acceptanceOrganizationId,fullRefundOrganizationId,createFiscalAcceptanceApi} from './fiscalAcceptanceApi'
const email='tester@example.test'
const response={fixtureId:acceptanceFixtureId,organizationId:acceptanceOrganizationId,orderId:'11111111-1111-4111-8111-111111111111',amountMinor:99000,environment:'sandbox',shopId:'1467641',periodStart:'2026-09-29T05:00:00Z',periodEnd:'2026-09-29T05:30:00Z'}
function setup(){
 return {supabaseUrl:'https://jeugfyaqzfgdvfhdxfht.supabase.co',auth:{mfa:{
 listFactors:vi.fn(async()=>({data:{totp:[{id:'test-factor',status:'verified'}]}})),
 challengeAndVerify:vi.fn(async()=>({error:null}))}},functions:{invoke:vi.fn(async()=>({data:response,error:null}))}}
}
beforeEach(()=>{vi.stubGlobal('location',{origin:'https://stage-admin.qvesta.ru'});localStorage.clear();sessionStorage.clear()})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function prepare(){
 fireEvent.change(screen.getByLabelText('Адрес для тестового чека'),{target:{value:email}})
 fireEvent.click(screen.getByText('Подтвердить подготовку через MFA'))
 await screen.findByLabelText('Код MFA для заказа')
}
function submit(code='123456'){
 fireEvent.change(screen.getByLabelText('Код MFA для заказа'),{target:{value:code}})
 fireEvent.submit(screen.getByLabelText('Код MFA для заказа').closest('form'))
}
async function start(){
 const button=await screen.findByRole('button',{name:'Начать тестовый период'})
 expect(button).toBeDisabled()
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(button)
}
it('requires fresh MFA, invokes only preparation and never persists email or code',async()=>{
 const c=setup();render(<FiscalAcceptance client={c}/>);await prepare()
 expect(c.functions.invoke).not.toHaveBeenCalled();submit()
 await screen.findByRole('button',{name:'Начать тестовый период'})
 expect(c.functions.invoke).not.toHaveBeenCalled();await start()
 await screen.findByRole('status')
 expect(c.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({factorId:'test-factor',code:'123456'})
 expect(c.functions.invoke).toHaveBeenCalledExactlyOnceWith('admin-fiscal-acceptance-prepare',{body:{fixtureId:acceptanceFixtureId,email}})
 expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0)
 expect(screen.queryByText('Начать тестовый период')).toBeNull()
})
it('rejects bad email and absent verified factors without invoking endpoint',async()=>{
 const c=setup();render(<FiscalAcceptance client={c}/>)
 fireEvent.click(screen.getByText('Подтвердить подготовку через MFA'));await screen.findByRole('alert')
 expect(c.auth.mfa.listFactors).not.toHaveBeenCalled()
 c.auth.mfa.listFactors.mockResolvedValue({data:{totp:[]}})
 fireEvent.change(screen.getByLabelText('Адрес для тестового чека'),{target:{value:email}})
 fireEvent.click(screen.getByText('Подтвердить подготовку через MFA'))
 await screen.findByText('Сессия не подтверждена. Повторите вход с MFA.')
 expect(c.functions.invoke).not.toHaveBeenCalled()
})
it('MFA rejection and malformed code prevent preparation',async()=>{
 const c=setup();render(<FiscalAcceptance client={c}/>);await prepare();submit('1')
 await screen.findByText('Введите шесть цифр кода MFA.');expect(c.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
 c.auth.mfa.challengeAndVerify.mockResolvedValue({error:{}});submit()
 await screen.findByText('Код не принят. Введите новый код.');expect(c.functions.invoke).not.toHaveBeenCalled()
})
it('serializes double submission and preserves request across uncertain result and remount',async()=>{
 const c=setup();c.functions.invoke.mockRejectedValueOnce(Error('network'))
 const view=render(<FiscalAcceptance client={c}/>);await prepare();submit();await start();fireEvent.click(screen.getByRole('button',{name:'Повторить подготовку того же заказа'}))
 await screen.findByRole('alert');expect(c.functions.invoke).toHaveBeenCalledTimes(1)
 expect(screen.getByLabelText('Адрес для тестового чека')).toBeDisabled()
 fireEvent.click(screen.getByRole('button',{name:'Повторить подготовку того же заказа'}));await screen.findByRole('status')
 expect(c.functions.invoke.mock.calls[1]).toEqual(c.functions.invoke.mock.calls[0])
 view.unmount();render(<FiscalAcceptance client={c}/>);await prepare();submit();await start();await screen.findByRole('status')
 expect(c.functions.invoke.mock.calls[2]).toEqual(c.functions.invoke.mock.calls[0])
})
it('unmount during MFA prevents mutation',async()=>{
 const c=setup();let release;c.auth.mfa.challengeAndVerify.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
 const view=render(<FiscalAcceptance client={c}/>);await prepare();submit();view.unmount();release({error:null})
 await waitFor(()=>expect(c.functions.invoke).not.toHaveBeenCalled())
})
it.each(['origin','project'])('blocks wrong %s',async kind=>{
 const c=setup();if(kind==='origin')vi.stubGlobal('location',{origin:'https://admin.qvesta.ru'});else c.supabaseUrl='https://other.supabase.co'
 render(<FiscalAcceptance client={c}/>);expect(screen.queryByText('Подготовка тестового заказа')).toBeNull()
 await expect(createFiscalAcceptanceApi(c).prepare(email)).rejects.toThrow('stage_required');expect(c.functions.invoke).not.toHaveBeenCalled()
})
it.each(['sandbox_disabled','authentication_required','fixture_access_denied'])('distinguishes %s',async code=>{
 const c=setup();c.functions.invoke.mockResolvedValue({error:{context:{json:async()=>({error:code})}}})
 await expect(createFiscalAcceptanceApi(c).prepare(email)).rejects.toThrow(code)
})
it.each([{organizationId:'other'},{fixtureId:'other'},{shopId:'other'},{amountMinor:1},{environment:'production'},{periodEnd:'invalid'},{periodEnd:'2026-09-29T06:00:00Z'},{orderId:null}])('rejects altered server result %j',async change=>{
 const c=setup();c.functions.invoke.mockResolvedValue({data:{...response,...change}})
 await expect(createFiscalAcceptanceApi(c).prepare(email)).rejects.toThrow('preparation_unconfirmed')
})

it('scoped fiscal mode applies only to the acceptance organization on stage',async()=>{
 const {isAcceptanceOrganization}=await import('./fiscalAcceptanceApi')
 const c=setup()
 expect(isAcceptanceOrganization(c,acceptanceOrganizationId)).toBe(true)
 expect(isAcceptanceOrganization(c,fullRefundOrganizationId)).toBe(true)
 expect(isAcceptanceOrganization(c,'other')).toBe(false)
 vi.stubGlobal('location',{origin:'https://admin.qvesta.ru'})
 expect(isAcceptanceOrganization(c,acceptanceOrganizationId)).toBe(false)
})
