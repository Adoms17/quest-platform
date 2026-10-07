// @vitest-environment node
import {test, expect} from 'vitest'
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {randomUUID, createHash} from 'node:crypto'

test.skipIf(process.env.RUN_HISTORY_DIAGNOSTIC_TEST !== '1')('read-only history diagnostic on synthetic 324/326/drift ledgers', async () => {
  const root = new URL('../', import.meta.url)
  const owner = `qvesta-history-${randomUUID()}`
  const config = new URL('.review.local/docker-client/', root)
  mkdirSync(config, {recursive:true})
  const receipt = {owner, checks:[], cleanup:false}
  const docker = (args, input) => {
    const result = spawnSync('docker', ['--config', config.pathname.replace(/^\/(\w:)/,'$1'), ...args], {input, encoding:'utf8', timeout:30000, windowsHide:true})
    if (result.status !== 0) throw Error(`Local Docker ${args[0]} failed: ${args[0]==='exec' ? result.stderr : result.error?.message || result.status}`)
    return result.stdout.trim()
  }
  let id
  try {
    id = docker(['create','--pull','never','--name',owner,'--label',`qvesta.test.owner=${owner}`,'--network','none','--tmpfs','/tmp','--entrypoint','sh','supabase/postgres:17.6.1.165','-c','mkdir /tmp/history-pg; chown postgres:postgres /tmp/history-pg; gosu postgres initdb -D /tmp/history-pg -A trust >/dev/null && exec gosu postgres postgres -D /tmp/history-pg -c listen_addresses='])
    const info = JSON.parse(docker(['inspect',id]))[0]
    expect(info.Config.Labels['qvesta.test.owner']).toBe(owner)
    expect(info.HostConfig.NetworkMode).toBe('none')
    expect(info.HostConfig.PortBindings || {}).toEqual({})
    docker(['start',id])
    const sql = source => docker(['exec','-i',id,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],source)
    let ready = false
    for(let i=0;i<80;i++) { try {sql('select 1'); ready=true; break} catch {await new Promise(resolve=>setTimeout(resolve,250))} }
    expect(ready).toBe(true)
    const base = readdirSync(new URL('supabase/migrations/',root)).filter(n=>n.endsWith('.sql')&&n<'20261006010000').map(n=>n.split('_')[0]).sort()
    const release = ['20261003000000','20261003010000']
    const pending = ['20261006010000','20261006020000']
    const query=readFileSync(new URL('docs/qa/staging-owner-packet-20261007/00-history-diagnostic.sql',root),'utf8')
    sql(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); insert into supabase_migrations.schema_migrations values ${base.map(id=>`('${id}')`).join(',')};`)
    const inspect = () => {const before=sql('select version from supabase_migrations.schema_migrations order by version');const result=JSON.parse(sql(query));expect(sql('select version from supabase_migrations.schema_migrations order by version')).toBe(before);expect(result.transaction_read_only).toBe('on');return result}
    const baseline=inspect()
    expect(baseline.actual_count).toBe(324)
    expect(baseline.actual_versions).toEqual(base)
    expect(baseline.actual_versions_sha256_lf).toBe(createHash('sha256').update(base.join('\n')).digest('hex'))
    expect(baseline.missing_vs_baseline).toEqual([])
    expect(baseline.extra_vs_baseline).toEqual([])
    expect(baseline.missing_vs_candidate).toEqual([...release,...pending])
    receipt.checks.push('324 baseline/hash/read-only PASS')
    sql(`insert into supabase_migrations.schema_migrations values ${release.map(id=>`('${id}')`).join(',')}`)
    const full=inspect()
    expect(full.actual_count).toBe(326)
    expect(full.actual_versions).toEqual([...base,...release])
    expect(full.missing_vs_baseline).toEqual([])
    expect(full.extra_vs_baseline).toEqual(release)
    expect(full.known_release_ids_present).toEqual(release)
    expect(full.pending_feature_ids_present).toEqual([])
    expect(full.missing_vs_current).toEqual([])
    expect(full.extra_vs_current).toEqual([])
    expect(full.actual_versions_sha256_lf).toBe('43e62d2b3279dfe6b443c5ec1dd4d29e9d2ed720bad80b019661caea173eeceb')
    expect(full.missing_vs_candidate).toEqual(pending)
    expect(full.unexpected_vs_candidate).toEqual([])
    receipt.checks.push('326 approved current comparison PASS')
    sql(`delete from supabase_migrations.schema_migrations where version='${base[0]}'; insert into supabase_migrations.schema_migrations values('20990101000000')`)
    const drift=inspect()
    expect(drift.actual_count).toBe(326)
    expect(drift.missing_vs_baseline).toEqual([base[0]])
    expect(drift.missing_vs_candidate).toEqual([base[0],...pending])
    expect(drift.missing_vs_current).toEqual([base[0]])
    expect(drift.extra_vs_current).toEqual(['20990101000000'])
    expect(drift.extra_vs_baseline).toEqual([...release,'20990101000000'])
    expect(drift.unexpected_vs_candidate).toEqual(['20990101000000'])
    receipt.checks.push('same count with missing/extra detected PASS')
    sql(`update supabase_migrations.schema_migrations set version='${base[0]}' where version='20990101000000'; insert into supabase_migrations.schema_migrations values ${pending.map(id=>`('${id}')`).join(',')}`)
    const after=inspect()
    expect(after.actual_count).toBe(328)
    expect(after.missing_vs_candidate).toEqual([])
    expect(after.unexpected_vs_candidate).toEqual([])
    expect(after.known_release_ids_present).toEqual(release)
    expect(after.pending_feature_ids_present).toEqual(pending)
    receipt.checks.push('328 post-apply comparison PASS')
  } finally {
    if(id) {const info=JSON.parse(docker(['inspect',id]))[0]; expect(info.Id).toBe(id); expect(info.Config.Labels['qvesta.test.owner']).toBe(owner); docker(['rm','-f',id]);receipt.cleanup=true}
    writeFileSync(new URL('.review.local/history-diagnostic-evidence.json',root),JSON.stringify(receipt,null,2))
  }
},120000)
