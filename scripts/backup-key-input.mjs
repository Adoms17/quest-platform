export function decodeBackupKey(value) {
 if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Error('invalid_backup_key')
 const key = Buffer.from(value, 'base64')
 if (key.length !== 32 || key.toString('base64') !== value) { key.fill(0); throw Error('invalid_backup_key') }
 return key
}
export async function readBackupKeys(input) {
 let bytes=0
 const chunks=[]
 try {
  for await (const chunk of input) {
   const buffer=Buffer.from(chunk); bytes+=buffer.length
   if(bytes>128) { buffer.fill(0); throw Error('invalid_backup_key_input') }
   chunks.push(buffer)
  }
  const joined=Buffer.concat(chunks)
  try {
   const lines=joined.toString('utf8').replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n')
   if(lines.length!==2) throw Error('invalid_backup_key_input')
   const first=decodeBackupKey(lines[0])
   try { return [first,decodeBackupKey(lines[1])] } catch { first.fill(0); throw Error('invalid_backup_key_input') }
  } finally { joined.fill(0) }
 } catch { throw Error('invalid_backup_key_input') }
 finally { for(const chunk of chunks) chunk.fill(0) }
}