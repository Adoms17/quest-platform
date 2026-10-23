import {beforeEach,expect,test,vi} from 'vitest'
const client=vi.hoisted(()=>({rpc:vi.fn(),functions:{invoke:vi.fn()},storage:{from:vi.fn()}}))
vi.mock('../supabaseClient',()=>({supabase:client}))
import {normalizeNickname,saveParticipantIdentity,downloadParticipantAvatar,uploadParticipantAvatar} from './participantIdentityApi'
const profile='10000000-0000-4000-8000-000000000001',upload='20000000-0000-4000-8000-000000000002'
beforeEach(()=>vi.resetAllMocks())
test('nickname remains separate, optional, Unicode and non-unique',()=>{
 expect(normalizeNickname('  Саша_7 ')).toBe('Саша_7');expect(normalizeNickname(' ')).toBeNull()
})
test.each(['a','a'.repeat(41),'two words','<img>','a/b','a&b','a\u0000b'])('rejects invalid nickname %j',name=>expect(()=>normalizeNickname(name)).toThrow())
test('saving supplies the participant and revision, never account username',async()=>{
 client.rpc.mockResolvedValue({data:{id:profile,identity_revision:3}})
 await saveParticipantIdentity(profile,2,' Nick ')
 expect(client.rpc).toHaveBeenCalledWith('save_participant_identity',{p_profile:profile,p_revision:2,p_nickname:'Nick',p_upload:null,p_remove_avatar:false})
})
test('server edit refusal is preserved',async()=>{
 client.rpc.mockResolvedValue({error:{code:'42501'}})
 await expect(saveParticipantIdentity(profile,0,'Nick')).rejects.toEqual({code:'42501'})
})
test.each(['https://external.test/a.png','data:image/svg+xml,<svg/>',`${upload}/${upload}.png`,'../other.png'])('no request for external/wrong profile path %s',async path=>{
 await expect(downloadParticipantAvatar(profile,path)).rejects.toThrow('invalid_avatar_path');expect(client.storage.from).not.toHaveBeenCalled()
})
test('avatar download uses authenticated storage, not public or signed URL',async()=>{
 const blob={type:'image/png',size:8,slice:()=>({arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer})}
 const download=vi.fn(async()=>({data:blob}));client.storage.from.mockReturnValue({download})
 expect(await downloadParticipantAvatar(profile,`${profile}/${upload}.png`)).toBe(blob)
 expect(client.storage.from).toHaveBeenCalledWith('participant-avatars');expect(download).toHaveBeenCalledWith(`${profile}/${upload}.png`)
})
test('upload acknowledgement must belong to the selected request',async()=>{
 client.functions.invoke.mockResolvedValue({data:{uploadId:'wrong'}})
 await expect(uploadParticipantAvatar(profile,0,new Blob(),upload)).rejects.toThrow('avatar_unconfirmed')
})
