const ERROR_MESSAGES_BY_CODE = {
  over_email_send_rate_limit:
    'Временно исчерпан лимит отправки писем. Попробуйте позже или обратитесь к администратору.',
  invalid_credentials: 'Неверный email или пароль.',
  email_not_confirmed: 'Подтвердите email перед входом.',
  user_already_exists: 'Пользователь с таким email уже зарегистрирован.',
  signup_disabled: 'Регистрация временно отключена.',
  weak_password: 'Пароль не соответствует требованиям безопасности.',
}

const MESSAGE_MATCHERS = [
  {
    pattern: 'email rate limit exceeded',
    message:
      'Временно исчерпан лимит отправки писем. Попробуйте позже или обратитесь к администратору.',
  },
  {
    pattern: 'invalid login credentials',
    message: 'Неверный email или пароль.',
  },
  {
    pattern: 'email not confirmed',
    message: 'Подтвердите email перед входом.',
  },
  {
    pattern: 'failed to fetch',
    message: 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.',
  },
]

export function getAuthErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase()
  if (ERROR_MESSAGES_BY_CODE[code]) return ERROR_MESSAGES_BY_CODE[code]

  const technicalMessage = String(error?.message || '').toLowerCase()
  const matched = MESSAGE_MATCHERS.find(({ pattern }) =>
    technicalMessage.includes(pattern),
  )

  return matched?.message || 'Не удалось выполнить операцию. Попробуйте ещё раз.'
}

export function logAuthError(operation, error) {
  console.error(operation, {
    code: error?.code || '',
    status: error?.status || 0,
    message: error?.message || String(error),
  })
}