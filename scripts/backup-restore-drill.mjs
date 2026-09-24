import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, copyFile, rm, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path'
import { decryptBackup } from './backup-crypto.mjs'
import { encryptBackupProcess } from './backup-process.mjs'
import { fileURLToPath } from 'node:url'
import { readBackupKeys } from './backup-key-input.mjs'

const savedKey = process.argv.length === 4 && process.argv[3] === '--saved-key-stdin'
if ((!savedKey && process.argv.length !== 3) || process.argv[2] !== '--synthetic') throw Error('Only --synthetic is supported; no live database inputs accepted')
const name = 'qvesta-backup-drill-' + randomUUID().replaceAll('-', '')
let key, restoreKey
const exportArchive=process.env.QVESTA_DRILL_ARCHIVE_OUT
const importArchive=process.env.QVESTA_DRILL_ARCHIVE_IN
const expectedHash=process.env.QVESTA_DRILL_EXPECTED_SHA256
let created = false, directory
function docker(args, input) {
 const result = spawnSync('docker', args, { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
 if (result.status !== 0) throw Error('isolated_backup_drill_command_failed')
 return result.stdout
}
const sql = (db, query) => docker(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],query).toString().trim()
try {
 if((exportArchive || importArchive) && !savedKey || exportArchive && importArchive) throw Error('invalid_archive_mode')
 if(importArchive && !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw Error('reference_checksum_required')
 if(exportArchive) {
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url)))
  const parent=await realpath(dirname(resolve(exportArchive)))
  const location=relative(root,parent)
  if(!(location.startsWith('..'+sep) || location==='..' || isAbsolute(location))) throw Error('archive_must_be_outside_repository')
 }
 if(savedKey) { [key,restoreKey]=await readBackupKeys(process.stdin) } else { key=randomBytes(32); restoreKey=key }
 docker(['run','-d','--network','none','--name',name,'--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir -p /tmp/drill-pg; chown postgres:postgres /tmp/drill-pg; gosu postgres initdb -D /tmp/drill-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/drill-pg'])
 created = true
 let ready=false
 for(let i=0;i<60;i++) {
  try { docker(['exec',name,'pg_isready','-U','postgres']); ready=true; break } catch { await new Promise(r=>setTimeout(r,500)) }
 }
 if(!ready) throw Error('isolated_database_not_ready')
 sql('postgres','create role backup_drill_reader; create database backup_source; create database backup_restored;')
 sql('backup_source',`create table public.drill_items(id integer primary key, tenant_id integer not null, label text not null);
 insert into public.drill_items values(1,1,'Синтетический квест'),(2,2,'Other synthetic tenant');
 alter table public.drill_items enable row level security;
 create policy tenant_read on public.drill_items for select to backup_drill_reader using(tenant_id=current_setting('drill.tenant')::integer);
 grant usage on schema public to backup_drill_reader;
 grant select on public.drill_items to backup_drill_reader;`)


 directory=await mkdtemp(join(tmpdir(),'qvesta-backup-drill-'))
 const local=join(directory,'local.qvb'), replica=join(directory,'replica.qvb')
 await encryptBackupProcess({executable:'docker',args:['exec',name,'pg_dump','-U','postgres','-d','backup_source','--format=custom','--no-owner'],destination:local,key})
 const encrypted=await readFile(local)
 await copyFile(local,replica)
 if(importArchive && (await stat(importArchive)).size>64*1024*1024+64) throw Error('archive_too_large')
 const copied=await readFile(importArchive || replica)
 const hash=data=>createHash('sha256').update(data).digest('hex')
 if((importArchive ? expectedHash : hash(encrypted))!==hash(copied)) throw Error('replica_checksum_mismatch')
 const restored=decryptBackup(copied,restoreKey)

 docker(['exec','-i',name,'pg_restore','-U','postgres','-d','backup_restored','--exit-on-error','--no-owner'],restored)
 const snapshot=db=>sql(db,"select json_agg(t order by id) from public.drill_items t;")
 if(snapshot('backup_source')!==snapshot('backup_restored')) throw Error('restored_rows_mismatch')
 const rls=sql('backup_restored',"set role backup_drill_reader; set drill.tenant='1'; select count(*) from public.drill_items;")
 if(rls!=='1') throw Error('restored_rls_failed')
 const schema=sql('backup_restored',"select relrowsecurity and exists(select 1 from pg_constraint where conrelid='public.drill_items'::regclass and contype='p') from pg_class where oid='public.drill_items'::regclass;")
 if(schema!=='t') throw Error('restored_schema_failed')
 if(exportArchive) await writeFile(resolve(exportArchive),encrypted,{flag:'wx',mode:0o600})
 console.log(JSON.stringify({synthetic:true,savedKeyInput:savedKey,archiveSaved:!!exportArchive,downloadedArchiveVerified:!!importArchive,sha256:hash(copied),encryptedBytes:copied.length,replicaChecksumVerified:true,rowsVerified:2,rlsVerified:true,primaryKeyVerified:true,cloudUploaded:false}))
} catch {
 console.error('Synthetic backup drill failed; raw database output suppressed.')
 process.exitCode=1
} finally {
 key?.fill(0); restoreKey?.fill(0)
 if(created && /^qvesta-backup-drill-[a-f0-9]{32}$/.test(name)) docker(['rm','-f','-v',name])
 if(directory && dirname(resolve(directory))===resolve(tmpdir()) && /^qvesta-backup-drill-/.test(basename(directory))) await rm(directory,{recursive:true,force:true})
}