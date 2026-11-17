// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adminHeaders } from './securityHeaders.mjs'

describe('защитные заголовки admin', () => {
  it('разрешает соединение только с выбранным API, запрещает встраивание и кэш', () => {
    const headers = adminHeaders('https://example.supabase.co')
    expect(headers).toContain('connect-src https://example.supabase.co;')
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).toContain("worker-src 'none'")
    expect(headers).toContain("img-src 'self' data:")
    expect(headers).toContain('Cache-Control: no-store')
    expect(headers).not.toMatch(/unsafe-inline|unsafe-eval/)
  })
  it.each(['https://example.test/path', 'https://user:pass@example.test', 'https://example.test?x=1', 'data:text/plain,example'])('отклоняет не-origin %s', value => {
    expect(() => adminHeaders(value)).toThrow()
  })
})
