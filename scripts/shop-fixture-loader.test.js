import { test, expect } from 'vitest'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, basename, dirname } from 'node:path'
import { loadShopFixturePlan } from './shop-fixture-loader.js'

test('pinned 327 baseline + six fixtures: all missing/extra/tamper cases deny without Docker', () => {
  const root = mkdtempSync(join(tmpdir(), 'qvesta-fixture-denial-'))
  try {
    cpSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'), { recursive: true })
    cpSync(resolve('scripts/fixtures/shop-stage-six'), join(root, 'scripts/fixtures/shop-stage-six'), { recursive: true })
    const good = loadShopFixturePlan(root)
    expect(good.historical).toHaveLength(324)
    expect(good.late).toHaveLength(9)
    const cases = [
      ['baseline missing', 'supabase/migrations/' + good.historical[0].name, 'remove'],
      ['fixture missing', 'scripts/fixtures/shop-stage-six/' + good.late[3].name, 'remove'],
      ['baseline hash mismatch', 'supabase/migrations/' + good.historical[0].name, 'tamper'],
      ['fixture hash mismatch', 'scripts/fixtures/shop-stage-six/' + good.late[3].name, 'tamper'],
      ['baseline extra', 'supabase/migrations/29990101000000_unexpected.sql', 'extra'],
      ['fixture extra', 'scripts/fixtures/shop-stage-six/29990101000000_unexpected.sql', 'extra'],
      ['manifest tamper', 'scripts/fixtures/shop-stage-six/manifest.json', 'tamper'],
      ['manifest reordered', 'scripts/fixtures/shop-stage-six/manifest.json', 'reorder'],
    ]
    for (const [label, relative, operation] of cases) {
      const file = join(root, relative), original = operation === 'extra' ? null : readFileSync(file)
      try {
        if (operation === 'remove') unlinkSync(file)
        else if (operation === 'reorder') { const data=JSON.parse(original); data.fixtures.reverse(); writeFileSync(file,JSON.stringify(data)) }
        else writeFileSync(file, original ? Buffer.concat([original, Buffer.from('\n-- tampered\n')]) : '-- unexpected')
        expect(() => loadShopFixturePlan(root), label).toThrow()
      } finally { if (original) writeFileSync(file, original); else unlinkSync(file) }
    }
    expect(loadShopFixturePlan(root).manifestSha256).toBe(good.manifestSha256)
  } finally {
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('qvesta-fixture-denial-')) throw Error('Unsafe test cleanup path')
    rmSync(root, { recursive: true })
  }
})
