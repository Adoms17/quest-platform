export const AVATAR_MAX_BYTES = 1048576
const signature = [137,80,78,71,13,10,26,10]
function crc(bytes) {
 let value=0xffffffff
 for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0)}
 return (value^0xffffffff)>>>0
}
export async function boundedBytes(stream, limit) {
 const reader=stream.getReader(),parts=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length
  if(size>limit){await reader.cancel();throw Error('avatar_too_large')}parts.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0
 for(const part of parts){bytes.set(part,offset);offset+=part.length}return bytes
}
// Canonical browser-produced PNG only: no SVG, HTML, animation, metadata or trailing payload.
export async function validateAvatarPng(bytes) {
 if(!(bytes instanceof Uint8Array)||bytes.length>AVATAR_MAX_BYTES||bytes.length<45
  ||signature.some((value,i)=>bytes[i]!==value))throw Error('invalid_avatar_png')
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[]
 let offset=8,width=0,height=0,bpp=0,ended=false
 while(offset+12<=bytes.length){
  const length=view.getUint32(offset),end=offset+12+length
  if(end>bytes.length)throw Error('invalid_avatar_png')
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8))
  if(crc(bytes.subarray(offset+4,offset+8+length))!==view.getUint32(offset+8+length))throw Error('invalid_avatar_png')
  if(type==='IHDR'&&offset===8&&length===13){
   width=view.getUint32(offset+8);height=view.getUint32(offset+12)
   const color=bytes[offset+17];bpp=color===6?4:color===2?3:0
   if(!width||!height||width>512||height>512||bytes[offset+16]!==8||!bpp
    ||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])throw Error('invalid_avatar_png')
  }else if(type==='IDAT'&&bpp&&!ended){parts.push(bytes.subarray(offset+8,offset+8+length))}
  else if(type==='IEND'&&length===0&&parts.length&&end===bytes.length){ended=true}
  else throw Error('invalid_avatar_png')
  offset=end
 }
 if(!ended||offset!==bytes.length)throw Error('invalid_avatar_png')
 const stride=width*bpp+1,expected=stride*height
 const raw=await boundedBytes(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')),expected)
 if(raw.length!==expected)throw Error('invalid_avatar_png')
 for(let i=0;i<raw.length;i+=stride)if(raw[i]>4)throw Error('invalid_avatar_png')
 return {width,height}
}
