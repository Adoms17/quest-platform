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
  if (error?.code === 'OFFLINE_START_PERMISSION_REQUIRED') return 'Для нового офлайн-прохождения заранее подготовьте старт в разделе «Мои квесты» при подключении к интернету.'

  if (error?.code === 'P0001' && ['quest start billing unavailable', 'offline permit billing unavailable'].includes(error.message)) {
    return 'Новый старт пока недоступен по тарифу организации. Ранее начатое прохождение и сохранённые результаты остаются доступны. Обратитесь к организатору.'
  }
  if (error?.code === 'P0001' && error.message === 'active quest quota exceeded') {
    return 'Достигнут лимит открытых квестов организации. Закройте другой квест и попробуйте снова.'
  }
  if (error?.code === 'P0001' && error.message === 'quest quota unavailable') {
    return 'Не удалось открыть квест: тариф организации не активен или не настроен. Обратитесь к владельцу организации.'
  }
  if (error?.code === '23505' && ['offline permit already bound', 'offline permit registration conflict', 'offline permit registration required'].includes(error.message)) {
    return 'Не удалось связать результаты с исходным прохождением. Они сохранены на этом устройстве. Не удаляйте загрузку и обратитесь к организатору.'
  }
  if (error?.code === '42501' && ['offline permit access denied', 'offline permit scope mismatch'].includes(error.message)) {
    return 'Нет доступа к исходному офлайн-прохождению. Неотправленные результаты сохранены на устройстве. Проверьте выбранный профиль или обратитесь к организатору.'
  }
  if (error?.code === '55000' && error.message === 'participant merge has conflicting offline permits') {
    return 'У обоих профилей подготовлено прохождение одного квеста. Завершите и отправьте результаты перед объединением профилей.'
  }
  if (error?.code === '40001') {
    return 'Не удалось сохранить изменения из-за одновременного запроса. Попробуйте ещё раз.'
  }
  if (error?.code === 'P0001' && error.message === 'team member quota exceeded') {
    return 'В команде организации нет свободных мест. Обратитесь к владельцу организации и повторите попытку после освобождения места.'
  }
  if (error?.code === 'P0001' && error.message === 'team quota unavailable') {
    return 'Не удалось добавить сотрудника: тариф организации не активен или не настроен. Обратитесь к владельцу организации.'
  }
  if (error?.code === 'P0001' && ['registered offline attempt finished', 'registered offline attempt removed', 'redeemed offline attempt removed'].includes(error.message)) {
    return 'Исходная попытка завершена или удалена. Неотправленные результаты сохранены на устройстве. Обратитесь к организатору.'
  }
  if (error?.code === '42501' && error.message === 'offline attempt scope mismatch') {
    return 'Не удалось сопоставить офлайн-попытку с исходным профилем. Неотправленные результаты сохранены на устройстве. Обратитесь к организатору.'
  }

  return fallback
}
