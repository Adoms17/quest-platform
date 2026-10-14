import { withAuthTimeout } from './authRequest'

export const RECOVERY_PATH = '/auth/recovery'
export const RECOVERY_LOGIN = '/login?recovery=complete'
export const INVALID_RECOVERY = 'Ссылка недействительна или устарела. Запросите новое письмо.'

// No raw SDK error/message, URL, email or password is logged or returned.
export function recoveryError(error) {
  if (['weak_password', 'same_password'].includes(error?.code)) return 'Выберите другой пароль, соответствующий требованиям безопасности.'
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit') return 'Слишком много запросов. Попробуйте позже.'
  if ([401, 403].includes(error?.status) || ['session_not_found', 'otp_expired', 'refresh_token_not_found'].includes(error?.code)) return INVALID_RECOVERY
  return 'Не удалось выполнить операцию. Проверьте соединение и попробуйте ещё раз.'
}

export function createPasswordRecovery(auth, location, history) {
  let initialization
  let ready = false
  let saving = false
  let complete = false
  return {
    initialize() {
      // One consumption per document, including React StrictMode remounts.
      if (initialization) return initialization
      initialization = (async () => {
        const params = new URLSearchParams(location.hash.slice(1))
        const query = new URLSearchParams(location.search)
        history.replaceState(null, '', RECOVERY_PATH)
        if (params.get('type') !== 'recovery' || !params.get('access_token') || !params.get('refresh_token') ||
          ['error', 'error_code', 'error_description'].some(key => params.has(key) || query.has(key)) || query.has('code')) {
          return false
        }
        try {
          const { data, error } = await withAuthTimeout(auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') }))
          ready = !error && Boolean(data?.session?.user?.id)
          return ready
        } catch { return false }
      })().catch(() => false)
      return initialization
    },
    async save(password) {
      if (!ready || complete || saving) return { error: INVALID_RECOVERY }
      saving = true
      try {
        const { data, error } = await withAuthTimeout(auth.updateUser({ password }))
        if (error) {
          const message = recoveryError(error)
          if (message === INVALID_RECOVERY) ready = false
          return { error: message }
        }
        if (!data?.user?.id) return { error: recoveryError() }
        ready = false
        complete = true
        return { error: null }
      } catch (error) {
        if (error?.code === 'auth_request_timeout') {
          ready = false
          return { error: 'Результат сохранения не подтверждён. Попробуйте войти с новым паролем или запросите новую ссылку.', terminal: true }
        }
        return { error: recoveryError() }
      }
      finally { saving = false }
    },
  }
}
