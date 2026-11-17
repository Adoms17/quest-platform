import {beforeEach,expect,test,vi} from 'vitest'
import {render,screen,fireEvent} from '@testing-library/react'
const mock=vi.hoisted(()=>({checkSandboxSession:vi.fn(),leaveSandboxSession:vi.fn()}))
vi.mock('../services/sandboxSession',()=>mock)
import SandboxSessionCheck from './SandboxSessionCheck'
beforeEach(()=>vi.resetAllMocks())
test('checking session never signs out without explicit recovery',async()=>{
 mock.checkSandboxSession.mockResolvedValue(false)
 render(<SandboxSessionCheck actorId="actor"/> )
 expect(mock.checkSandboxSession).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Проверить сессию приложения'}))
 const recovery=await screen.findByRole('button',{name:'Войти заново в приложении'})
 expect(mock.leaveSandboxSession).not.toHaveBeenCalled()
 fireEvent.click(recovery)
 await screen.findByText('Сессия приложения закрыта. Перейдите ко входу.')
 expect(mock.leaveSandboxSession).toHaveBeenCalledTimes(1)
})
test('server verification reports readiness without any payment action',async()=>{
 mock.checkSandboxSession.mockResolvedValue(true)
 render(<SandboxSessionCheck actorId="actor"/> )
 fireEvent.click(screen.getByRole('button',{name:'Проверить сессию приложения'}))
 await screen.findByText(/Сессия подтверждена сервером/)
 expect(mock.checkSandboxSession).toHaveBeenCalledWith('actor')
 expect(mock.leaveSandboxSession).not.toHaveBeenCalled()
})
