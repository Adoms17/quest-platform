const png=[137,80,78,71,13,10,26,10]
export function avatarDimensions(bytes,type) {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 if(type==='image/png'&&bytes.length>=24&&png.every((n,i)=>bytes[i]===n))return [view.getUint32(16),view.getUint32(20)]
 if(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
  let i=2
  while(i+4<bytes.length&&i<65536){
   if(bytes[i++]!==255)break
   while(bytes[i]===255)i++
   const marker=bytes[i++],length=view.getUint16(i)
   if(length<2||i+length>bytes.length)break
   if([192,193,194].includes(marker)&&length>=8)return [view.getUint16(i+5),view.getUint16(i+3)]
   if(marker===218||marker===217)break
   i+=length
  }
 }
 throw Error('invalid_avatar_file')
}
export async function prepareParticipantAvatar(file) {
 if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024||!file.size)throw Error('invalid_avatar_file')
 const bytes=new Uint8Array(await file.arrayBuffer()),[width,height]=avatarDimensions(bytes,file.type)
 if(!width||!height||width>4096||height>4096||width*height>16777216)throw Error('invalid_avatar_file')
 const bitmap=await createImageBitmap(file)
 try{
  if(bitmap.width>4096||bitmap.height>4096)throw Error('invalid_avatar_file')
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256
  const context=canvas.getContext('2d');if(!context)throw Error('avatar_conversion_failed')
  const ratio=Math.min(256/bitmap.width,256/bitmap.height),w=bitmap.width*ratio,h=bitmap.height*ratio
  context.drawImage(bitmap,(256-w)/2,(256-h)/2,w,h)
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
  if(!blob||blob.type!=='image/png'||blob.size>1048576)throw Error('avatar_conversion_failed')
  return blob
 }finally{bitmap.close()}
}
