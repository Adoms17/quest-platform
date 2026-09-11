import { isTransportError } from './network'

export const OFFLINE_ERROR_MESSAGE =
  'Нет соединения с сервером. Проверьте интернет и попробуйте снова.'

export function getUserErrorMessage(
  error,
  fallback = 'Не удалось выполнить операцию. Попробуйте ещё раз.',
) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return OFFLINE_ERROR_MESSAGE
  }
  if (isTransportError(error)) return OFFLINE_ERROR_MESSAGE

  return fallback
}
