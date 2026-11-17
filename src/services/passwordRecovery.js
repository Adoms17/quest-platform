import { withAuthTimeout } from './authRequest'

export const RECOVERY_PATH = '/auth/recovery'
export const RECOVERY_LOGIN = '/login?recovery=complete'
export const INVALID_RECOVERY = 'Ссылка недействительна или устарела. Запросите новое письмо.'
export const MFA_REQUIRED = 'Для смены пароля подтвердите второй фактор.'
export const MFA_UNAVAILABLE = 'Доступный фактор приложения-аутентификатора не найден. Для восстановления доступа обратитесь в поддержку.'
const MFA_REJECTED = 'Подтверждение второго фактора отклонено. Вернитесь ко входу или обратитесь в поддержку.'

// No raw SDK error/message, URL, email or password is logged or returned.
export function recoveryError(error) {
  if (error?.code === 'insufficient_aal') return MFA_REQUIRED
  if (['mfa_factor_not_found', 'mfa_totp_verify_not_enabled'].includes(error?.code)) return MFA_UNAVAILABLE
  if (['mfa_verification_rejected', 'mfa_ip_address_mismatch'].includes(error?.code)) return MFA_REJECTED
  if (['mfa_verification_failed', 'mfa_challenge_expired'].includes(error?.code)) return 'Код неверен или устарел. Введите новый код из приложения-аутентификатора.'
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
  let needsMfa = false
  let verifying = false
  let factors = []
  let initializationError = INVALID_RECOVERY
  function verificationFailure(error) {
    const message = recoveryError(error)
    if ([INVALID_RECOVERY, MFA_UNAVAILABLE, MFA_REJECTED].includes(message)) {
      ready = false
      return { error: message, terminal: true }
    }
    return { error: message }
  }
  return {
    initializationError: () => initializationError,
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
          if (error) initializationError = recoveryError(error)
          return ready
        } catch { initializationError = recoveryError(); return false }
      })().catch(() => false)
      return initialization
    },
    async listMfa() {
      if (!ready || !needsMfa || complete) return { error: INVALID_RECOVERY }
      try {
        const { data, error } = await withAuthTimeout(auth.mfa.listFactors())
        if (error) return { error: 'Не удалось проверить второй фактор. Вернитесь ко входу или обратитесь в поддержку.' }
        factors = (data?.totp ?? []).filter(f => f.status === 'verified' && f.factor_type === 'totp')
        return factors.length ? { factors: factors.map((f, i) => ({ id: f.id, label: `Приложение-аутентификатор ${i + 1}` })) } : { error: MFA_UNAVAILABLE }
      } catch { return { error: 'Не удалось проверить второй фактор. Вернитесь ко входу или обратитесь в поддержку.' } }
    },
    async verifyMfa(factorId, code, signal) {
      if (!ready || !needsMfa || complete || verifying || signal?.aborted) return { error: MFA_REQUIRED }
      if (!factors.some(f => f.id === factorId)) return { error: MFA_UNAVAILABLE }
      if (!/^\d{6}$/.test(code)) return { error: 'Введите шестизначный код из приложения-аутентификатора.' }
      verifying = true
      try {
        const challenge = await withAuthTimeout(auth.mfa.challenge({ factorId }))
        if (signal?.aborted) return { canceled: true }
        if (challenge.error) return verificationFailure(challenge.error)
        if (!challenge.data?.id) return { error: recoveryError() }
        const result = await withAuthTimeout(auth.mfa.verify({ factorId, challengeId: challenge.data.id, code }))
        if (signal?.aborted) return { canceled: true }
        if (result.error) return verificationFailure(result.error)
        const assurance = await withAuthTimeout(auth.mfa.getAuthenticatorAssuranceLevel())
        if (signal?.aborted) return { canceled: true }
        if (assurance.error) return verificationFailure(assurance.error)
        if (assurance.data?.currentLevel !== 'aal2') return { error: MFA_REQUIRED }
        needsMfa = false
        return { error: null }
      } catch (error) {
        // An ambiguous late SDK result must never unlock a password mutation.
        if (error?.code === 'auth_request_timeout') {
          ready = false
          return { error: 'Подтверждение не завершено. Вернитесь ко входу; не повторяйте смену пароля на этой странице.', terminal: true }
        }
        return { error: recoveryError() }
      } finally { verifying = false }
    },
    async save(password) {
      if (!ready || complete || saving) return { error: INVALID_RECOVERY }
      if (needsMfa) return { error: MFA_REQUIRED, mfa: true }
      saving = true
      try {
        const { data, error } = await withAuthTimeout(auth.updateUser({ password }))
        if (error) {
          if (error.code === 'insufficient_aal') { needsMfa = true; return { error: MFA_REQUIRED, mfa: true } }
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
