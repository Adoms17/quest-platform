import { describe, expect, it } from 'vitest'
import {
  formatQuestAccessCode,
  isCompleteQuestAccessCode,
} from './questAccessCode'

describe('quest access code presentation', () => {
  it('нормализует вставленный код', () => {
    expect(formatQuestAccessCode('a1b2c3 d4e5f6')).toBe('A1B2C3-D4E5F6')
  })

  it('ограничивает ввод двенадцатью шестнадцатеричными символами', () => {
    expect(formatQuestAccessCode('A1B2C3-D4E5F6-FFFF')).toBe('A1B2C3-D4E5F6')
    expect(formatQuestAccessCode('ZZ-A1')).toBe('A1')
  })

  it('проверяет полноту кода независимо от разделителя', () => {
    expect(isCompleteQuestAccessCode('A1B2C3-D4E5F6')).toBe(true)
    expect(isCompleteQuestAccessCode('A1B2C3')).toBe(false)
  })
})

