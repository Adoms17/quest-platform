import {beforeEach,expect,test,vi} from 'vitest'
const {getUser,signOut}=vi.hoisted(()=>({getUser:vi.fn(),signOut:vi.fn()}))
vi.mock('../supabaseClient',()=>({supabase:{auth:{getUser,signOut}}}))
import {checkSandboxSession,leaveSandboxSession} from './sandboxSession'
beforeEach(()=>vi.resetAllMocks())
test('checks identity with Auth rather than cached session',async()=>{
 getUser.mockResolvedValue({data:{user:{id:'actor'}}})
 expect(await checkSandboxSession('actor')).toBe(true)
 expect(await checkSandboxSession('other')).toBe(false)
})
test('revoked session requires login; network failure remains unconfirmed',async()=>{
 getUser.mockResolvedValueOnce({error:{status:403,code:'session_not_found'}}).mockResolvedValueOnce({error:{status:503}})
 expect(await checkSandboxSession('actor')).toBe(false)
 await expect(checkSandboxSession('actor')).rejects.toThrow('session_check_unconfirmed')
 expect(signOut).not.toHaveBeenCalled()
})
test('explicit recovery ends only local session',async()=>{
 signOut.mockResolvedValue({error:null})
 await leaveSandboxSession()
 expect(signOut).toHaveBeenCalledExactlyOnceWith({scope:'local'})
})
