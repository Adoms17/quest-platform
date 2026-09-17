import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserErrorMessage, OFFLINE_ERROR_MESSAGE } from './userErrorMessage'

describe('getUserErrorMessage', () => {
  it.each(['offline permit already bound', 'offline permit registration conflict', 'offline permit registration required'])('объясняет конфликт %s без потери данных', message => {
    expect(getUserErrorMessage({ code: '23505', message })).toContain('Не удаляйте загрузку')
    expect(getUserErrorMessage({ code: '23505', message })).toContain('обратитесь к организатору')
  })
  it('не раскрывает неизвестный конфликт', () => {
    expect(getUserErrorMessage({ code: '23505', message: 'private details' }, 'Ошибка.')).toBe('Ошибка.')
  })

  it('объясняет заполненную команду без технических деталей', () => {
    expect(getUserErrorMessage({ code: 'P0001', message: 'team member quota exceeded' })).toContain('В команде организации нет свободных мест.')
  })
  it('объясняет недоступный тариф команды', () => {
    expect(getUserErrorMessage({ code: 'P0001', message: 'team quota unavailable' })).toContain('тариф организации не активен или не настроен')
  })
  it('объясняет исчерпанную квоту и следующий шаг', () => {
    expect(getUserErrorMessage({ code: 'P0001', message: 'active quest quota exceeded' })).toBe(
      'Достигнут лимит открытых квестов организации. Закройте другой квест и попробуйте снова.',
    )
  })
  it('объясняет неподключённый тариф без предложения несуществующей оплаты', () => {
    expect(getUserErrorMessage({ code: 'P0001', message: 'quest quota unavailable' })).toContain('Обратитесь к владельцу организации')
  })
  it('предлагает повтор после конфликта транзакций', () => {
    expect(getUserErrorMessage({ code: '40001', message: 'internal SQL detail' })).toContain('Попробуйте ещё раз')
  })
  it('не раскрывает произвольную ошибку P0001', () => {
    expect(getUserErrorMessage({ code: 'P0001', message: 'private data' }, 'Ошибка сохранения.')).toBe('Ошибка сохранения.')
  })
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
  it('объясняет несовпадение профиля офлайн-попытки без технических подробностей', () => {
    expect(getUserErrorMessage({ code: '42501', message: 'offline attempt scope mismatch' })).toContain('Неотправленные результаты сохранены на устройстве')
    expect(getUserErrorMessage({ code: '42501', message: 'private details' }, 'Нет доступа.')).toBe('Нет доступа.')
  })

  it('does not infer that an arbitrary Russian backend message is safe', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(getUserErrorMessage(
      new Error('Внутренняя ошибка таблицы participant_profiles'),
      'Не удалось загрузить квест.',
    )).toBe('Не удалось загрузить квест.')
  })
})
