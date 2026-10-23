import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { verifyReceiptFiles as verifyPreviousReceiptFiles } from './check-subscription-acceptance-release.mjs'
import { parseMigrationHistory } from './check-admin-stage-migrations.mjs'
export const manifest=JSON.parse(readFileSync(new URL('../docs/tasks/PROD-PAY-02-migrations.json',import.meta.url),'utf8').replace(/^\uFEFF/,''))
const prerequisiteVersions=['WEB-PAY-02-migrations.json','BILL-REFUND-01-migrations.json','WEB-PAY-03-migrations.json','WEB-PAY-03-model-migrations.json','WEB-PAY-03-balances-migrations.json','WEB-PAY-03-acceptance-migrations.json'].flatMap(file=>JSON.parse(readFileSync(new URL('../docs/tasks/'+file,import.meta.url),'utf8').replace(/^\uFEFF/,'')).map(item=>item.version))
export const prerequisites=[...new Set([...prerequisiteVersions,'20260926038000'])]
export function validateReceiptRelease(history,entries=manifest){
 const allowed=new Set(entries.map(item=>item.version)),seen=new Set(),pending=[]
 if(allowed.size!==entries.length||entries.length===0)throw Error('Invalid release manifest')
 if(!Array.isArray(history?.migrations)||!history.migrations.length)throw Error('Missing migration history')
 for(const row of history.migrations){
  if(!row.local||seen.has(row.local)||row.remote&&row.remote!==row.local)throw Error('Migration history mismatch')
  seen.add(row.local)
  if(!row.remote){if(!allowed.has(row.local))throw Error('Unrelated pending migration');pending.push(row.local)}
 }
 if([...allowed].some(version=>!seen.has(version)))throw Error('Incomplete receipt release')
 if(prerequisites.some(version=>!history.migrations.some(row=>row.local===version && row.remote===version)))throw Error('Receipt prerequisites not applied')
 const sorted=[...allowed].sort(); const firstPending=sorted.findIndex(version=>pending.includes(version));
 if(firstPending>=0&&sorted.slice(firstPending).some(version=>!pending.includes(version)))throw Error('Non-prefix model release');
 return pending.sort()
}
export function validateReceiptPreview(output,pending){
 const files=[...new Set(output.match(/\b\d{14}_[a-zA-Z0-9_-]+\.sql\b/g)||[])].sort()
 const expected=manifest.filter(item=>pending.includes(item.version)).map(item=>item.file).sort()
 if(JSON.stringify(files)!==JSON.stringify(expected))throw Error('Receipt preview differs from approved pending migrations')
 return files
}
export function verifyReceiptFiles(){
 verifyPreviousReceiptFiles()
 for(const item of manifest){
  const data=readFileSync(new URL('../supabase/migrations/'+item.file,import.meta.url))
  if(createHash('sha256').update(data.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n')).digest('hex')!==item.sha256)throw Error('Receipt migration changed: '+item.file)
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.SUPABASE_PROJECT_ID!=='jeugfyaqzfgdvfhdxfht')throw Error('Stage project required')
 if(!process.argv[2])throw Error('Saved migration history file required')
 verifyReceiptFiles()
 const pending=validateReceiptRelease(parseMigrationHistory(readFileSync(process.argv[2],'utf8')))
 const previewIndex=process.argv.indexOf('--preview')
 if(previewIndex!==-1){if(!process.argv[previewIndex+1])throw Error('Preview file required');validateReceiptPreview(readFileSync(process.argv[previewIndex+1],'utf8'),pending)}
 if(process.argv.includes('--require-applied')&&pending.length)throw Error('Receipt migrations not applied')
 console.log('Receipt release pending: '+(pending.join(', ')||'none'))
}
