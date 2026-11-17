import { useEffect, useRef, useState } from 'react'
import { withAuthTimeout } from '../services/authRequest'
import { RECOVERY_PATH, recoveryError } from '../services/passwordRecovery'

export default function RecoveryRequest({ auth, onBack }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const busy = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function submit(event) {
    event.preventDefault()
    if (busy.current || state === 'sent' || state === 'unknown') return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Введите корректный email.'); return }
    busy.current = true
    setState('sending')
    setError('')
    try {
      const { error: failure } = await withAuthTimeout(auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
      }))
      if (alive.current) {
        setState(failure ? 'idle' : 'sent')
        if (failure) setError(recoveryError(failure))
      }
    } catch (failure) {
      if (alive.current) {
        const unknown = failure?.code === 'auth_request_timeout'
        setState(unknown ? 'unknown' : 'idle')
        setError(unknown ? 'Отправка не подтверждена. Проверьте почту перед новым запросом.' : recoveryError(failure))
      }
    } finally { busy.current = false }
  }
  return <section className="mt-6">
    <h2 className="text-xl font-semibold">Восстановление пароля</h2>
    {state === 'sent' ? <p role="status">Если аккаунт с таким email существует, вы получите письмо со ссылкой для восстановления.</p> : <form onSubmit={submit} noValidate className="mt-5 space-y-3">
      <label className="block">Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={['sending', 'unknown'].includes(state)} className="w-full rounded-lg bg-blue-600 p-3 text-white disabled:opacity-50">{state === 'sending' ? 'Подождите…' : 'Отправить ссылку'}</button>
    </form>}
    <button type="button" className="mt-4 text-blue-600" onClick={onBack}>Вернуться ко входу</button>
  </section>
}
