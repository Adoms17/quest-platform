// @vitest-environment node
import { expect, it } from 'vitest'
import { validateAdminMigrationHistory } from './check-admin-stage-migrations.mjs'
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
