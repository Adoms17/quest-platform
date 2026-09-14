import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppEntry, getLoginDestination, isOrganizationPath, rememberAppContext } from './appNavigation'

describe('навигация контекстов', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('изолирует выбор аккаунта и сохраняет явное переключение', () => {
    expect(getAppEntry('a')).toBe('/home')
    rememberAppContext('a', 'organization')
    expect(getAppEntry('a')).toBe('/quests')
    expect(getAppEntry('b')).toBe('/home')
    rememberAppContext('a', 'participant')
    expect(getAppEntry('a')).toBe('/home')
  })
  it('сохраняет назначение ссылки независимо от предпочтения', () => {
    rememberAppContext('a', 'organization')
    expect(getLoginDestination('/play/q?participant=p', 'a')).toBe('/play/q?participant=p')
    expect(getLoginDestination('/access/redeem?token=test', 'a')).toBe('/access/redeem?token=test')
    for (const path of ['https://example.test', '//example.test', '/\\example.test', '/login', null]) {
      expect(getLoginDestination(path, 'a')).toBe('/quests')
    }
  })
  it('определяет контекст по маршруту, не подменяя права', () => {
    expect(isOrganizationPath('/quests/q/edit')).toBe(true)
    expect(isOrganizationPath('/organization/team')).toBe(true)
    expect(isOrganizationPath('/play/q')).toBe(false)
    expect(isOrganizationPath('/my-quests')).toBe(false)
  })
  it('продолжает навигацию при недоступном localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
    expect(() => rememberAppContext('a', 'organization')).not.toThrow()
    expect(getAppEntry('a')).toBe('/home')
  })
})
