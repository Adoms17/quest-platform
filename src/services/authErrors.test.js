import { describe, expect, it, vi } from 'vitest'
import { getAuthErrorMessage, logAuthError } from './authErrors'

describe('getAuthErrorMessage', () => {
  it('localizes the Supabase email rate-limit code', () => {
    expect(
      getAuthErrorMessage({ code: 'over_email_send_rate_limit' }),
    ).toContain('лимит отправки писем')
  })

  it('supports the legacy rate-limit message', () => {
    expect(
      getAuthErrorMessage({ message: 'email rate limit exceeded' }),
    ).toContain('лимит отправки писем')
  })

  it('localizes invalid credentials', () => {
    expect(getAuthErrorMessage({ code: 'invalid_credentials' })).toBe(
      'Неверный email или пароль.',
    )
  })

  it('returns a useful offline message for network failures', () => {
    expect(getAuthErrorMessage(new TypeError('Failed to fetch'))).toContain(
      'Нет соединения',
    )
  })

  it('does not expose an unknown technical message', () => {
    expect(getAuthErrorMessage({ message: 'internal auth detail' })).toBe(
      'Не удалось выполнить операцию. Попробуйте ещё раз.',
    )
  })
})

describe('logAuthError', () => {
  it('logs only normalized technical fields', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    logAuthError('Ошибка входа', {
      code: 'invalid_credentials',
      status: 400,
      message: 'Invalid login credentials',
      email: 'private@example.com',
    })

    expect(consoleError).toHaveBeenCalledWith('Ошибка входа', {
      code: 'invalid_credentials',
      status: 400,
      message: 'Invalid login credentials',
    })

    consoleError.mockRestore()
  })
})