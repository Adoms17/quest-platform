import { describe, it, expect } from 'vitest'
import { checkLocalToolOptions, requireLocalConfig } from './local-tool-options.mjs'

const id = '11111111-1111-4111-8111-111111111111'
describe('ограничения локальных инструментов', () => {
  it.each([
    ['checkout', []], ['checkout', ['--execute', '--extra']],
    ['renewal', [id]], ['renewal', [id, '999', '--execute']],
    ['renewal', ["'; select 1; --", '--execute']],
    ['refund', [id, '1e2', id]], ['refund', [id, '-1', id]],
    ['refund', [id, '100', id, '--exectue']],
    ['refund', [id, '9007199254740993', id]], ['integration', ['--stage']],
  ])('отклоняет %s %j до внешних действий', (tool, args) => {
    expect(() => checkLocalToolOptions(tool, args)).toThrow()
  })
  it.each([
    ['integration', []], ['integration', ['--gateway-only']], ['checkout', ['--execute']],
    ['renewal', [id, '--execute']], ['renewal', [id, '1000', '--execute']],
    ['refund', [id, '100', id]], ['refund', [id, '100', id, '--execute']],
  ])('принимает %s %j', (tool, args) => {
    expect(() => checkLocalToolOptions(tool, args)).not.toThrow()
  })
  it.each(['https://stage.qvesta.ru', 'https://example.supabase.co', 'http://127.0.0.1:9999'])('отсекает другой backend %s', API_URL => {
    expect(() => requireLocalConfig({ API_URL, ANON_KEY: 'test', SERVICE_ROLE_KEY: 'test' })).toThrow()
  })
  it('требует локальные ключи и точный адрес', () => {
    expect(() => requireLocalConfig({ API_URL: 'http://127.0.0.1:54321' })).toThrow()
    expect(() => requireLocalConfig({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'test', SERVICE_ROLE_KEY: 'test' })).not.toThrow()
  })
})
