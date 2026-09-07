export function getAnswerResultMessage(serverState) {
  if (serverState.correct) {
    return { type: 'success', message: 'Правильный ответ!' }
  }

  if (serverState.failed) {
    return {
      type: 'terminal',
      message: 'Ответ неверный. Попытки закончились — задание не пройдено.',
    }
  }

  const remaining = serverState.remaining_attempts
  return {
    type: 'retry',
    message: remaining === null || remaining === undefined
      ? 'Неправильный ответ, попробуйте ещё раз.'
      : `Неправильный ответ. Осталось попыток: ${remaining}`,
  }
}
