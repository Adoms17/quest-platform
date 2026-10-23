import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseMigrationHistory } from './check-admin-stage-migrations.mjs'
export const manifest=JSON.parse(readFileSync(new URL('../docs/tasks/WEB-PAY-02-migrations.json',import.meta.url),'utf8').replace(/^\uFEFF/,''))
export function validateDocumentRelease(history,entries=manifest){
 const allowed=new Set(entries.map(item=>item.version)),seen=new Set(),pending=[]
 if(allowed.size!==entries.length||entries.length===0)throw Error('Invalid release manifest')
 if(!Array.isArray(history?.migrations)||!history.migrations.length)throw Error('Missing migration history')
 for(const row of history.migrations){
  if(!row.local||seen.has(row.local)||row.remote&&row.remote!==row.local)throw Error('Migration history mismatch')
  seen.add(row.local)
  if(!row.remote){if(!allowed.has(row.local))throw Error('Unrelated pending migration');pending.push(row.local)}
 }
 if([...allowed].some(version=>!seen.has(version)))throw Error('Incomplete document release')
 return pending.sort()
}
export function verifyDocumentFiles(){
 for(const item of manifest){
  const data=readFileSync(new URL('../supabase/migrations/'+item.file,import.meta.url))
  if(createHash('sha256').update(data.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n')).digest('hex')!==item.sha256)throw Error('Document migration changed: '+item.file)
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.SUPABASE_PROJECT_ID!=='jeugfyaqzfgdvfhdxfht')throw Error('Stage project required')
 if(!process.argv[2])throw Error('Saved migration history file required')
 verifyDocumentFiles()
 const pending=validateDocumentRelease(parseMigrationHistory(readFileSync(process.argv[2],'utf8')))
 if(process.argv.includes('--require-applied')&&pending.length)throw Error('Document migrations not applied')
 console.log('Document release pending: '+(pending.join(', ')||'none'))
}
