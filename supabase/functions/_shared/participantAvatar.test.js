// @vitest-environment node
import {deflateSync} from 'node:zlib'
import {expect,test,vi} from 'vitest'
import {validateAvatarPng,boundedBytes} from './participantAvatarPng.js'
import {createParticipantAvatarEndpoint} from './participantAvatarEndpoint.js'
function chunk(type,data){
 const tag=Buffer.from(type),body=Buffer.concat([tag,data]);let crc=0xffffffff
 for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8);return out
}
function png({width=1,height=1,color=6,extra=false,raw=Buffer.from([0,255,0,0,255])}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(extra?[chunk('tEXt',Buffer.from('<script>'))]:[]),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
test('validates actual PNG chunks, CRC, bounded decompression and dimensions',async()=>{
 expect(await validateAvatarPng(png())).toEqual({width:1,height:1})
})
test.each([
 ['SVG',()=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
 ['HTML',()=>Buffer.from('<html><script>alert(1)</script></html>')],
 ['oversize dimension',()=>png({width:513})],['zero dimension',()=>png({width:0})],
 ['palette',()=>png({color:3})],['metadata',()=>png({extra:true})],
 ['decompression excess',()=>png({raw:Buffer.alloc(100000)})],
 ['truncated pixels',()=>png({raw:Buffer.alloc(2)})],['bad filter',()=>png({raw:Buffer.from([5,0,0,0,0])})],
 ['trailing payload',()=>Buffer.concat([png(),Buffer.from('<svg/>')])],
 ['CRC mismatch',()=>{const bytes=png();bytes[20]^=1;return bytes}],
 ['file limit',()=>Buffer.alloc(1048577)],
])('rejects %s',async(_,make)=>{await expect(validateAvatarPng(make())).rejects.toThrow()})
test('stream reader enforces actual bytes, not client Content-Length',async()=>{
 await expect(boundedBytes(new Blob([new Uint8Array(100)]).stream(),10)).rejects.toThrow('avatar_too_large')
})
const profile='10000000-0000-4000-8000-000000000001',upload='20000000-0000-4000-8000-000000000002'
function setup(){
 const calls=[];const rpc=vi.fn(async()=>{calls.push('begin');return {data:`${profile}/${upload}.png`}})
 const deps={authenticate:vi.fn(async()=>{calls.push('auth');return {id:'actor',client:{rpc}}}),
 store:vi.fn(async()=>{calls.push('store')}),confirm:vi.fn(async()=>{calls.push('confirm')}),clean:vi.fn(async()=>{}),allowedOrigins:['https://stage.qvesta.ru']}
 const handler=createParticipantAvatarEndpoint(deps)
 const request=(body=png(),headers={})=>new Request('https://example.test/avatar',{method:'POST',body,headers:{
  origin:'https://stage.qvesta.ru',authorization:'Bearer synthetic','content-type':'image/png','x-profile-id':profile,'x-upload-id':upload,'x-profile-revision':'0',...headers}})
 return {deps,rpc,handler,request,calls}
}
test('authenticated edit guard precedes upload and trusted ready confirmation',async()=>{
 const s=setup(),response=await s.handler(s.request());expect(response.status).toBe(200)
 expect(await response.json()).toEqual({uploadId:upload});expect(s.calls).toEqual(['auth','begin','store','confirm'])
 expect(s.rpc).toHaveBeenCalledWith('begin_participant_avatar',{p_profile:profile,p_upload:upload,p_revision:0})
 expect(response.headers.get('cache-control')).toBe('no-store')
 expect(response.headers.get('access-control-allow-headers')).toContain('x-supabase-api-version')
})
test.each([['42501',403],['40001',409]])('SQL %s refusal prevents storage writes',async(code,status)=>{
 const s=setup();s.rpc.mockResolvedValue({error:{code}})
 expect((await s.handler(s.request())).status).toBe(status);expect(s.deps.store).not.toHaveBeenCalled();expect(s.deps.confirm).not.toHaveBeenCalled()
})
test('unauthorized caller does not reserve or upload',async()=>{
 const s=setup();s.deps.authenticate.mockResolvedValue(null)
 expect((await s.handler(s.request())).status).toBe(401);expect(s.rpc).not.toHaveBeenCalled();expect(s.deps.store).not.toHaveBeenCalled()
})
test.each([{'content-type':'image/svg+xml'},{'x-profile-id':'../other'},{'x-profile-revision':'-1'},{origin:'https://attacker.test'}])('invalid headers never upload: %j',async headers=>{
 const s=setup();expect((await s.handler(s.request(png(),headers))).status).toBeGreaterThanOrEqual(400);expect(s.deps.store).not.toHaveBeenCalled()
})
test('PNG MIME cannot disguise SVG content',async()=>{
 const s=setup();expect((await s.handler(s.request(Buffer.from('<svg/>')))).status).toBe(400);expect(s.rpc).not.toHaveBeenCalled()
})
test('storage failure cannot mark ready and cleanup is exact profile/upload',async()=>{
 const s=setup();s.deps.store.mockRejectedValue(Error('private internal failure'))
 const response=await s.handler(s.request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private internal')
 expect(s.deps.confirm).not.toHaveBeenCalled();expect(s.deps.clean).toHaveBeenCalledWith(expect.anything(),profile,upload)
})
test('cleanup is authenticated and cannot accept a caller-supplied storage path',async()=>{
 const s=setup();const response=await s.handler(s.request(JSON.stringify({action:'cleanup',profileId:profile,path:'another/file.png'}),{'content-type':'application/json'}))
 expect(response.status).toBe(400);expect(s.deps.clean).not.toHaveBeenCalled()
})
test('trusted failure cleanup works after edit permission loss and only after a successful reservation',async()=>{
 const s=setup(),abortUpload=vi.fn(async()=>{});s.deps.confirm.mockRejectedValue(Error('lost permission'))
 const handler=createParticipantAvatarEndpoint({...s.deps,abortUpload})
 expect((await handler(s.request())).status).toBe(503);expect(abortUpload).toHaveBeenCalledWith(profile,upload)
 expect(s.deps.clean).not.toHaveBeenCalled();abortUpload.mockClear();s.rpc.mockResolvedValue({error:{code:'42501'}})
 expect((await handler(s.request())).status).toBe(403);expect(abortUpload).not.toHaveBeenCalled()
})
test('two claimed cleanups cannot delete a new current avatar between their Storage deletes',async()=>{
 // RPC double models the UUID-only anti-reuse contract; the companion pgTAP executes
 // actual begin/claim/finish functions. This unit test is not proof of DB isolation.
 const s=setup(),oldPath=`${profile}/${upload}.png`,fresh='20000000-0000-4000-8000-000000000003'
 const objects=new Map([[oldPath,png()]]),reservations=new Set([upload])
 const liveRows=new Map([[upload,{profile,actor:'actor',path:oldPath,createdAt:1,expiresAt:2}]])
 let current=null,claims=0
 const releases=[];let bothClaimed
 const claimed=new Promise(resolve=>{bothClaimed=resolve})
 const clean=async()=>{
  const capturedPath=oldPath // Both workers already received this same deleting path.
  const gate=new Promise(resolve=>releases.push(resolve));if(++claims===2)bothClaimed()
  await gate;objects.delete(capturedPath);liveRows.delete(upload)
  // finish removes linked metadata but never removes the UUID-only reservation.
 }
 s.rpc.mockImplementation(async(_name,args)=>{
  if(reservations.has(args.p_upload))return {error:{code:'23505'}}
  reservations.add(args.p_upload)
  liveRows.set(args.p_upload,{profile:args.p_profile,actor:'actor',path:`${args.p_profile}/${args.p_upload}.png`})
  return {data:`${args.p_profile}/${args.p_upload}.png`}
 })
 s.deps.store.mockImplementation(async(path,bytes)=>{objects.set(path,bytes)})
 const handler=createParticipantAvatarEndpoint({...s.deps,clean,abortUpload:vi.fn()})
 const cleanupRequest=()=>s.request(JSON.stringify({action:'cleanup',profileId:profile}),{'content-type':'application/json'})
 const first=handler(cleanupRequest()),second=handler(cleanupRequest());await claimed
 releases[0]();expect((await first).status).toBe(200)
 expect(liveRows.has(upload)).toBe(false);expect([...reservations]).toEqual([upload])
 // Avoid entering another cleanup gate on failed begin; it is not the race under test.
 const uploadHandler=createParticipantAvatarEndpoint({...s.deps,abortUpload:vi.fn()})
 expect((await uploadHandler(s.request())).status).toBe(503)
 expect(s.deps.store).not.toHaveBeenCalled()
 expect((await uploadHandler(s.request(png(),{'x-upload-id':fresh}))).status).toBe(200)
 current=`${profile}/${fresh}.png`;expect(objects.has(current)).toBe(true)
 releases[1]();expect((await second).status).toBe(200)
 expect(objects.has(current)).toBe(true);expect(objects.has(oldPath)).toBe(false)
 expect(liveRows.has(upload)).toBe(false);expect(liveRows.get(fresh).path).toBe(current)
 expect(s.deps.store).toHaveBeenCalledOnce();expect(reservations.has(upload)).toBe(true)
})
