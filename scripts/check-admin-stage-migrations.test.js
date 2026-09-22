// @vitest-environment node
import { expect, it } from 'vitest'
import { validateAdminMigrationHistory, parseMigrationHistory, tariffReleaseMigrations, paymentReleaseMigrations } from './check-admin-stage-migrations.mjs'
const rows = () => Array.from({ length: 8 }, (_, i) => ({ local: `20260918${String(i + 1).padStart(2, '0')}0000`, remote: '' }))
it('разрешает только восемь admin-версий', () => expect(validateAdminMigrationHistory({ migrations: rows() })).toHaveLength(8))
it('разрешает продолжение после частичного применения', () => {
  const migrations = rows(); migrations[0].remote = migrations[0].local
  expect(validateAdminMigrationHistory({ migrations })).toHaveLength(7)
})
it.each([{ local: '20260919010000', remote: '' }, { local: '', remote: '20260919010000' }])('отклоняет посторонние версии', row => expect(() => validateAdminMigrationHistory({ migrations: [...rows(), row] })).toThrow())
it('отклоняет неполный набор и пустую историю', () => {
  expect(() => validateAdminMigrationHistory({ migrations: rows().slice(1) })).toThrow()
  expect(() => validateAdminMigrationHistory({ migrations: [] })).toThrow()
})

it('читает Linux-таблицу и JSON без потери remote-only строки', () => {
  const result = parseMigrationHistory('Local | Remote | Time\n20260918010000 | | 2026-09-18\n | 20260919010000 | 2026-09-19')
  expect(result.migrations).toHaveLength(2)
  expect(result.migrations[1].local).toBe('')
  expect(parseMigrationHistory(JSON.stringify({ migrations: rows() })).migrations).toHaveLength(8)
  expect(() => parseMigrationHistory('Local | Remote | Time\n123 | | bad')).toThrow()
})

it('catalog release requires applied foundation and allows only catalog', () => {
 const applied = rows().map(row => ({ ...row, remote: row.local }))
 const catalog = {local:'20260919010000',remote:''}
 expect(validateAdminMigrationHistory({migrations:[...applied,catalog]},true)).toEqual(['20260919010000'])
 expect(validateAdminMigrationHistory({migrations:[...applied,{...catalog,remote:catalog.local}]},true)).toEqual([])
 expect(()=>validateAdminMigrationHistory({migrations:[...rows(),catalog]},true)).toThrow()
 expect(()=>validateAdminMigrationHistory({migrations:applied},true)).toThrow()
 expect(()=>validateAdminMigrationHistory({migrations:[...applied,catalog,{local:'20260920010000',remote:''}]},true)).toThrow()
 expect(()=>validateAdminMigrationHistory({migrations:[...applied,catalog]})).toThrow()
})

it('тарифный релиз допускает ровно 47 миграций после применённого каталога',()=>{
 const base=[...rows().map(r=>({...r,remote:r.local})),{local:'20260919010000',remote:'20260919010000'}];
 const pending=tariffReleaseMigrations.map(local=>({local,remote:''}));
 expect(validateAdminMigrationHistory({migrations:[...base,...pending]},'tariff-release')).toHaveLength(47);
 expect(()=>validateAdminMigrationHistory({migrations:[...base,...pending.slice(1)]},'tariff-release')).toThrow();
 expect(()=>validateAdminMigrationHistory({migrations:[...base,...pending,{local:'20260920350000',remote:''}]},'tariff-release')).toThrow();
 expect(()=>validateAdminMigrationHistory({migrations:[...base.slice(0,-1),{local:'20260919010000',remote:''},...pending]},'tariff-release')).toThrow();
 expect(validateAdminMigrationHistory({migrations:[...base,...pending.map(r=>({...r,remote:r.local}))]},'tariff-release')).toEqual([]);
})

it('после прошлого выпуска ожидает только шесть миграций акций',()=>{
 const base=[...rows().map(r=>({...r,remote:r.local})),{local:'20260919010000',remote:'20260919010000'}]
 const history=tariffReleaseMigrations.map(local=>({local,remote:local>='20260921020000'?'':local}))
 expect(validateAdminMigrationHistory({migrations:[...base,...history]},'tariff-release').sort()).toEqual(['20260921020000','20260921030000','20260921040000','20260921050000','20260921060000','20260921070000'])
 expect(()=>validateAdminMigrationHistory({migrations:[...base,...history,{local:'20260921080000',remote:''}]},'tariff-release')).toThrow()
})

it('платёжный релиз разрешает только девять новых миграций после применённого основания', () => {
 const base = [...rows(), {local:'20260919010000'}, ...tariffReleaseMigrations.map(local=>({local}))].map(row=>({...row,remote:row.local}))
 const pending = paymentReleaseMigrations.map(local=>({local,remote:''}))
 const check = migrations => validateAdminMigrationHistory({migrations}, 'payments-release')
 expect(check([...base,...pending])).toEqual(paymentReleaseMigrations)
 expect(check([...base,...pending.map(row=>({...row,remote:row.local}))])).toEqual([])
 expect(check([...base,{...pending[0],remote:pending[0].local},...pending.slice(1)])).toHaveLength(8)
 expect(()=>check([...base,...pending.slice(1)])).toThrow()
 expect(()=>check([...base.map((row,i)=>i===base.length-1?{...row,remote:''}:row),...pending])).toThrow()
 expect(()=>check([...base,...pending,{local:'20260922100000',remote:''}])).toThrow()
 expect(()=>check([...base,...pending,{local:'',remote:'20260922100000'}])).toThrow()
 expect(()=>check([...base,...pending,pending[0]])).toThrow()
})
