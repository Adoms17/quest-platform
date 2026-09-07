import { describe, expect, it } from 'vitest'
import { getAnswerResultMessage } from './questResultPresentation'

describe('getAnswerResultMessage', () => {
  it('не представляет исчерпание попыток как серверную ошибку', () => {
    expect(getAnswerResultMessage({ correct: false, failed: true }))
      .toEqual({
        type: 'terminal',
        message: 'Ответ неверный. Попытки закончились — задание не пройдено.',
      })
  })

  it('показывает оставшееся количество попыток', () => {
    expect(getAnswerResultMessage({
      correct: false,
      failed: false,
      remaining_attempts: 2,
    }).message).toBe('Неправильный ответ. Осталось попыток: 2')
  })

  it('подтверждает правильный ответ', () => {
    expect(getAnswerResultMessage({ correct: true }).type).toBe('success')
  })
})
