const participantGroupErrorMessages = {
  'last participant supervisor cannot be revoked': 'Нельзя отозвать доступ последнего контролирующего взрослого, пока у ребёнка нет собственного аккаунта.',
  'participant profile is not orphaned': 'Восстановление не требуется: у профиля уже есть аккаунт или контролирующий взрослый.',
  'participant supervision denied': 'У вас нет доступа к управлению этим профилем участника.',
  'participant supervision recovery denied': 'Восстановить доступ может только создатель профиля, оставшегося без контролирующего взрослого.',
  'participant supervision management denied': 'У вас нет права управлять контролирующими взрослыми этого профиля.',
  'participant group management denied': 'У вас нет права управлять выбранной группой.',
  'participant group leader requires account': 'Руководителем группы может быть только профиль с собственным аккаунтом.',
  'participant group invitation denied': 'У вас нет права создать приглашение в выбранную группу.',
  'participant group invitation is not active': 'Приглашение в группу уже использовано или срок его действия истёк.',
  'participant group invitation belongs to another account': 'Приглашение в группу предназначено для другого аккаунта.',
  'self participant profile required': 'Для вступления в группу нужен самостоятельный профиль вашего аккаунта.',
  'participant group creator cannot leave': 'Создатель группы не может покинуть её. Сначала передайте управление или удалите группу.',
  'participant group membership denied': 'Ваш самостоятельный профиль не состоит в этой группе.',
  'participant profile rename denied': 'Изменить имя может только владелец профиля.',
  'invalid participant display name': 'Укажите имя длиной от 1 до 100 символов.',
  'self participant profile has active quest attempt': 'Сначала завершите текущее прохождение квеста в своём профиле, затем повторите принятие приглашения.',
  'participant profile already has an account': 'Этот профиль уже связан с другим самостоятельным аккаунтом.',
  'participant invitation is not active': 'Приглашение уже использовано, отозвано или срок его действия истёк.',
  'participant invitation belongs to another account': 'Приглашение предназначено для другого аккаунта.',
}

export function getParticipantGroupErrorMessage(error, fallback = 'Не удалось выполнить действие') {
  const technicalMessage = String(error?.message || '').toLowerCase()
  const match = Object.entries(participantGroupErrorMessages).find(([message]) =>
    technicalMessage.includes(message)
  )
  return match?.[1] || fallback
}
