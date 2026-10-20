// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('./wrangler.stage.jsonc', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
describe('изолированный хостинг admin stage', () => {
  it('публикует только отдельный согласованный stage-домен', () => {
    expect(config.name).toBe('qvesta-admin-stage')
    expect(config.routes).toEqual([{ pattern: 'stage-admin.qvesta.ru', custom_domain: true }])
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.env).toBeUndefined()
  })
  it('собирает stage перед загрузкой и берёт только admin/dist', () => {
    expect(config.build).toEqual({ cwd: '.', command: 'npm run build -- --config admin/vite.config.mjs --mode staging' })
    expect(config.assets.directory).toBe('./dist')
    expect(config.main).toBeUndefined()
    expect(config.assets.run_worker_first).toBeUndefined()
  })
})
