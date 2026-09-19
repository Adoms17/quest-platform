// @vitest-environment node
import { expect, it } from 'vitest'
import { validateAdminMigrationHistory, parseMigrationHistory } from './check-admin-stage-migrations.mjs'
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
