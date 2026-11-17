// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateAdminBuildEnvironment } from './buildEnvironment.mjs'

const valid = { VITE_ADMIN_SUPABASE_URL: 'https://example.supabase.co', VITE_ADMIN_SUPABASE_ANON_KEY: 'sb_publishable_synthetic' }
describe('среда сборки admin', () => {
  it('разрешает HTTPS с publishable key', () => expect(() => validateAdminBuildEnvironment(valid, 'production')).not.toThrow())
  it.each([
    {},
    { ...valid, VITE_ADMIN_SUPABASE_ANON_KEY: 'sb_secret_synthetic' },
    { ...valid, VITE_ADMIN_SUPABASE_URL: 'http://example.supabase.co' },
    { ...valid, VITE_ADMIN_SUPABASE_URL: 'https://localhost' },
    { ...valid, VITE_ADMIN_SUPABASE_URL: 'https://example.supabase.co/path' },
    { ...valid, VITE_ADMIN_SUPABASE_URL: 'https://example.supabase.co?secret=synthetic' },
    { ...valid, VITE_ADMIN_SUPABASE_ANON_KEY: 'synthetic-browser-placeholder' },
  ])('закрывает сборку с небезопасной/неполной конфигурацией %#', env => {
    expect(() => validateAdminBuildEnvironment(env, 'production')).toThrow('Некорректная среда admin')
  })
  it('не принимает JWT service_role', () => {
    const key = `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.c2ln`
    expect(() => validateAdminBuildEnvironment({ ...valid, VITE_ADMIN_SUPABASE_ANON_KEY: key }, 'production')).toThrow()
  })
  it('поддерживает legacy anon JWT, не утверждая проверку подписи', () => {
    const key = `e30.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.c2ln`
    expect(() => validateAdminBuildEnvironment({ ...valid, VITE_ADMIN_SUPABASE_ANON_KEY: key }, 'production')).not.toThrow()
  })
  it('синтетические параметры допустимы только в test на loopback', () => {
    const env = { VITE_ADMIN_SUPABASE_URL: 'http://127.0.0.1:54499', VITE_ADMIN_SUPABASE_ANON_KEY: 'synthetic-browser-placeholder' }
    expect(() => validateAdminBuildEnvironment(env, 'test')).not.toThrow()
    expect(() => validateAdminBuildEnvironment(env, 'production')).toThrow()
    expect(() => validateAdminBuildEnvironment(valid, 'test')).toThrow()
  })
})

// Контракт stage отделён от проверки формата публичного ключа.
describe('изоляция административной сборки stage', () => {
  const stage = { ...valid, VITE_ADMIN_SUPABASE_URL: 'https://jeugfyaqzfgdvfhdxfht.supabase.co' }
  it('принимает согласованный stage origin', () => {
    expect(() => validateAdminBuildEnvironment(stage, 'staging')).not.toThrow()
  })
  it.each([
    'https://example.supabase.co',
    'https://jeugfyaqzfgdvfhdxfht.supabase.co.attacker.test',
    'https://jeugfyaqzfgdvfhdxfht.supabase.co:444',
    'https://jeugfyaqzfgdvfhdxfht.supabase.co/path',
  ])('отклоняет другой origin или путь %s', address => {
    expect(() => validateAdminBuildEnvironment({ ...stage, VITE_ADMIN_SUPABASE_URL: address }, 'staging')).toThrow('Некорректная среда admin')
  })
})
