import { describe, expect, it } from 'vitest'
import { getParticipantGroupErrorMessage } from './participantGroupErrors'

describe('getParticipantGroupErrorMessage', () => {
  it.each([
    ['last participant supervisor cannot be revoked', 'Нельзя отозвать доступ последнего контролирующего взрослого'],
    ['participant profile is not orphaned', 'Восстановление не требуется'],
    ['participant supervision denied', 'У вас нет доступа к управлению этим профилем'],
    ['participant group leader requires account', 'Руководителем группы может быть только профиль с собственным аккаунтом'],
    ['participant group invitation belongs to another account', 'Приглашение в группу предназначено для другого аккаунта'],
    ['participant group creator cannot leave', 'Создатель группы не может покинуть её'],
    ['self participant profile has active quest attempt', 'Сначала завершите текущее прохождение квеста'],
  ])('translates %s', (technicalMessage, expected) => {
    expect(getParticipantGroupErrorMessage(new Error(technicalMessage))).toContain(expected)
  })

  it('does not expose an unknown server error', () => {
    expect(getParticipantGroupErrorMessage(new Error('internal details'), 'Не удалось изменить контроль'))
      .toBe('Не удалось изменить контроль')
  })
})
