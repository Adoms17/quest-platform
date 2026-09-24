// @vitest-environment node
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
const enabled=process.platform==='win32' && process.env.QVESTA_TEST_BACKUP_CLOUD==='1'
test.skipIf(!enabled)('PowerShell exports and verifies a separate archive; rejects overwrite and damage',()=>{
 const directory=mkdtempSync(join(tmpdir(),'qvesta-cloud-test-'))
 try {
  const wrapper=fileURLToPath(new URL('./Test-BackupSavedKey.ps1',import.meta.url)).replaceAll("'","''")
  const harness=join(directory,'harness.ps1')
  writeFileSync(harness,'\ufeff'+`param([string]$Action,[string]$Archive,[string]$Reference)
function global:Read-Host {
 param($Prompt,[switch]$AsSecureString)
 $secure=[Security.SecureString]::new()
 foreach($c in ([Convert]::ToBase64String([byte[]]::new(32))).ToCharArray()) { $secure.AppendChar($c) }
 return $secure
}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
function global:Set-Clipboard { param($Value); if($Value -eq '') { throw 'empty clipboard regression' } }
if($Action -eq 'export') { & '${wrapper}' -ExportArchive $Archive } else { & '${wrapper}' -VerifyArchive $Archive -ReferenceArchive $Reference }
exit $LASTEXITCODE
`)
  const run=(action,archive,reference)=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,'-Action',action,'-Archive',archive,...(reference?['-Reference',reference]:[])],{encoding:'utf8',timeout:90000,windowsHide:true,env:{...process.env,PSModulePath:join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')}})
  const original=join(directory,'original.qvb'),download=join(directory,'download.qvb')
  const created=run('export',original)
  expect(created.status).toBe(0)
  expect(created.stdout).toContain('"archiveSaved":true')
  const initial=readFileSync(original)
  copyFileSync(original,download)
  const verified=run('verify',download,original)
  expect(verified.status).toBe(0)
  expect(verified.stdout).toContain('"downloadedArchiveVerified":true')
  expect(verified.stdout).toContain('"rlsVerified":true')
  const overwrite=run('export',original)
  expect(overwrite.stdout).not.toContain('"archiveSaved":true')
  expect(readFileSync(original)).toEqual(initial)
  const corrupt=Buffer.from(initial); corrupt[corrupt.length-1]^=1; writeFileSync(download,corrupt)
  const damaged=run('verify',download,original)
  expect(damaged.stdout).not.toContain('"downloadedArchiveVerified":true')
  expect(damaged.status).not.toBe(0)
 } finally {
  if(dirname(resolve(directory))===resolve(tmpdir()) && basename(directory).startsWith('qvesta-cloud-test-')) rmSync(directory,{recursive:true,force:true})
 }
},240000)