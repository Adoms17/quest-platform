const ACCESS_DENIED_MESSAGES = new Set([
  'quest access denied',
  'Квест не найден или недоступен',
])

export function getQuestAccessErrorMessage(errorMessage) {
  if (!ACCESS_DENIED_MESSAGES.has(errorMessage)) return null
  return 'У вас нет активного доступа к этому квесту. Получите новую ссылку, код или приглашение у организатора.'
}
