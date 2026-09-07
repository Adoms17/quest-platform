import { describe, expect, it } from 'vitest'
import { getQuestAccessErrorMessage } from './questAccessErrors'

describe('getQuestAccessErrorMessage', () => {
  it.each(['quest access denied', 'Квест не найден или недоступен'])(
    'maps access failure %s to a participant-safe explanation',
    message => expect(getQuestAccessErrorMessage(message)).toContain('нет активного доступа')
  )

  it('does not hide an unexpected error', () => {
    expect(getQuestAccessErrorMessage('network failed')).toBeNull()
  })
})
