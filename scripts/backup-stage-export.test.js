// @vitest-environment node
import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verifyDatabaseBackupSet } from './backup-set.mjs'

// The entire CLI package is a synthetic fixture; these tests cannot access stage.
test.skipIf(process.platform !== 'win32')('actual PowerShell wrapper exports a synthetic set and fails closed', async () => {
 const dir=mkdtempSync(join(tmpdir(),'qvesta-stage-export-test-'))
 try {
  const scripts=join(dir,'project','worktree','scripts'), cli=join(dir,'project','node_modules','supabase')
  mkdirSync(scripts,{recursive:true}); mkdirSync(join(cli,'dist'),{recursive:true})
  for(const name of ['Export-StageBackup.ps1','backup-stage-export.mjs','backup-key-input.mjs','backup-process.mjs','backup-stream.mjs','backup-crypto.mjs','backup-set.mjs']) {
   copyFileSync(fileURLToPath(new URL(name,import.meta.url)),join(scripts,name))
  }
  writeFileSync(join(cli,'package.json'),JSON.stringify({name:'supabase',type:'module'}))
  writeFileSync(join(cli,'dist','supabase.js'),`
const args=process.argv.slice(2);
if(args[0]!=='db'||args[1]!=='dump'||args[args.indexOf('--project-ref')+1]!=='jeugfyaqzfgdvfhdxfht'||!args.includes('--linked')) process.exit(9);
process.stdout.write('-- synthetic SQL only\\n');
if(process.env.SYNTHETIC_FAIL==='1'&&args.includes('--data-only')) process.exit(7);
`)
  const harness=join(dir,'run.ps1')
  writeFileSync(harness,'\ufeff'+`
param([string]$BackupRoot)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
function global:Read-Host {
 param($Prompt,[switch]$AsSecureString)
 $secure=[Security.SecureString]::new()
 foreach($c in ([Convert]::ToBase64String([byte[]]::new(32))).ToCharArray()) { $secure.AppendChar($c) }
 return $secure
}
function global:Set-Clipboard { param($Value) }
& '${join(scripts,'Export-StageBackup.ps1').replaceAll("'","''")}' -BackupRoot $BackupRoot
exit $LASTEXITCODE
`)
  const run=(root,fail)=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,'-BackupRoot',root],{
   encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,SYNTHETIC_FAIL:fail?'1':'0',PSModulePath:join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')},
  })
  const successRoot=join(dir,'success'); mkdirSync(successRoot)
  const success=run(successRoot,false)
  expect(success.status,success.stdout).toBe(0)
  expect(success.stdout).toContain('Пять файлов выгружены, зашифрованы и проверены.')
  const result=join(successRoot,readdirSync(successRoot)[0])
  expect((await verifyDatabaseBackupSet(result,Buffer.alloc(32))).filesVerified).toBe(5)
  const failRoot=join(dir,'failure'); mkdirSync(failRoot)
  const failure=run(failRoot,true)
  expect(failure.status).toBe(1)
  expect(failure.stdout).toContain('Этап: dump-data.sql.qvb')
  expect(failure.stdout).toContain('Код завершения: 1')
  expect(readdirSync(join(failRoot,readdirSync(failRoot)[0]))).not.toContain('database-manifest.qvb')
  // Whole shared project root is forbidden, not just the scripts directory.
  expect(run(join(dir,'project'),false).status).toBe(1)
  expect(readdirSync(join(dir,'project')).some(name=>name.startsWith('stage-'))).toBe(false)
 } finally { rmSync(dir,{recursive:true,force:true}) }
},120000)