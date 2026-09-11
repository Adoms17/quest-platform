import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserErrorMessage, OFFLINE_ERROR_MESSAGE } from './userErrorMessage'

describe('getUserErrorMessage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns one Russian message when the browser is offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(getUserErrorMessage(new Error('arbitrary system detail'))).toBe(
      OFFLINE_ERROR_MESSAGE,
    )
  })

  it('recognizes a transport failure even before the offline event', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(getUserErrorMessage(new TypeError('Failed to fetch'))).toBe(
      OFFLINE_ERROR_MESSAGE,
    )
  })

  it('does not expose unknown technical messages', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(getUserErrorMessage(
      new Error('relation participant_profiles does not exist'),
      'Не удалось загрузить профили.',
    )).toBe('Не удалось загрузить профили.')
  })

  it('does not infer that an arbitrary Russian backend message is safe', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(getUserErrorMessage(
      new Error('Внутренняя ошибка таблицы participant_profiles'),
      'Не удалось загрузить квест.',
    )).toBe('Не удалось загрузить квест.')
  })
})
