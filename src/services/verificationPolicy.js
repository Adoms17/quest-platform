export function usesAnyLocationVerification(quest, task) {
  return Boolean(
    quest?.verification_match_policy === 'any' &&
      task?.requires_gps &&
      task?.requires_code
  )
}

export function getGeolocationErrorMessage(error) {
  switch (error?.code) {
    case 1:
      return 'Доступ к геопозиции запрещён. Разрешите его в настройках браузера и повторите попытку.'
    case 2:
      return 'Устройство не смогло определить геопозицию. Проверьте, включена ли геолокация.'
    case 3:
      return 'Не удалось определить геопозицию за отведённое время. Выйдите на открытое место и повторите попытку.'
    default:
      return 'Не удалось определить геопозицию. Повторите попытку.'
  }
}
