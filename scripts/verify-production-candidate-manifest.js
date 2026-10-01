// Read-only local integrity check. Never deploys or connects to a database.
import {readFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

const root=fileURLToPath(new URL('../',import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const read=path=>readFileSync(resolve(root,path))
const manifest=JSON.parse(read('docs/tasks/PROD-PAY-05-candidate-manifest.json'))
const expectedPaths=['scripts/production-sandbox-guard.candidate.sql','scripts/production-environment-pin.candidate.sql']
if(manifest.schemaVersion!==1||manifest.status!=='local-candidate-not-deployable'
 ||manifest.requiresQuiescentWorkers!==true
 ||JSON.stringify(manifest.files?.map(item=>item.path))!==JSON.stringify(expectedPaths)){
 throw new Error('Unexpected candidate manifest contract')
}
for(const item of manifest.files){
 if(hash(read(item.path))!==item.sha256)throw new Error('Candidate hash mismatch: '+item.path)
}
const migrations=readdirSync(resolve(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort()
const chain=migrations.map(name=>name+'\0'+hash(read('supabase/migrations/'+name))+'\n').join('')
if(migrations.length!==manifest.historicalMigrationCount||hash(chain)!==manifest.historicalChainSha256){
 throw new Error('Historical migration chain mismatch')
}
console.log('Local candidate integrity verified: 2 candidates, '+migrations.length+' historical migrations. Not a deployment approval.')
