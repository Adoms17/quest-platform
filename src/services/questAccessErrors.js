const ACCESS_DENIED_MESSAGES = new Set([
  'quest access denied',
  'Квест не найден или недоступен',
])

export function isQuestAccessDenied(error) {
  return ACCESS_DENIED_MESSAGES.has(error?.message) || error?.code === '42501' ||
    error?.status === 401 || error?.status === 403
}

export function getQuestAccessErrorMessage(errorMessage) {
  if (!ACCESS_DENIED_MESSAGES.has(errorMessage)) return null
  return 'У вас нет активного доступа к этому квесту. Получите новую ссылку, код или приглашение у организатора.'
}
