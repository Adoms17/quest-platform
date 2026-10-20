import {afterEach,expect,test,vi} from 'vitest'
import {avatarDimensions,prepareParticipantAvatar} from './prepareParticipantAvatar'
function source(width=256,height=256){const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);const v=new DataView(bytes.buffer);v.setUint32(16,width);v.setUint32(20,height);return bytes}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
test.each(['image/svg+xml','text/html','image/gif','image/webp'])('rejects unapproved MIME %s before decode',async type=>{
 const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode)
 await expect(prepareParticipantAvatar({type,size:100})).rejects.toThrow();expect(decode).not.toHaveBeenCalled()
})
test('PNG MIME with HTML bytes is rejected',()=>expect(()=>avatarDimensions(new TextEncoder().encode('<html>not PNG</html>'),'image/png')).toThrow())
test.each([[4097,1],[1,4097],[0,256]])('dimension limit checked before browser decode %j',async(width,height)=>{
 const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode)
 await expect(prepareParticipantAvatar({type:'image/png',size:24,arrayBuffer:async()=>source(width,height).buffer})).rejects.toThrow()
 expect(decode).not.toHaveBeenCalled()
})
test('rejects file size over 5 MiB before reading content',async()=>{
 const arrayBuffer=vi.fn();await expect(prepareParticipantAvatar({type:'image/jpeg',size:5*1024*1024+1,arrayBuffer})).rejects.toThrow();expect(arrayBuffer).not.toHaveBeenCalled()
})
test('re-encodes pixels into a new PNG and closes bitmap; original metadata is not uploaded',async()=>{
 const bitmap={width:256,height:128,close:vi.fn()};vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap))
 const drawImage=vi.fn(),result=new Blob(['canonical'],{type:'image/png'})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage})
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(result))
 const file={type:'image/png',size:24,arrayBuffer:async()=>source(256,128).buffer}
 expect(await prepareParticipantAvatar(file)).toBe(result);expect(drawImage).toHaveBeenCalledWith(bitmap,0,64,256,128);expect(bitmap.close).toHaveBeenCalled()
})
