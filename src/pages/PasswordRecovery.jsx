import { useEffect, useRef, useState } from 'react'
import AppBrand from '../components/AppBrand'
import RecoveryMfa from '../components/RecoveryMfa'
import { INVALID_RECOVERY, RECOVERY_LOGIN } from '../services/passwordRecovery'

export default function PasswordRecovery({ recovery }) {
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const pending = useRef(false)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    recovery.initialize().then(valid => {
      if (!alive.current) return
      const message = recovery.initializationError()
      setError(valid ? '' : message)
      setState(valid ? 'ready' : message === INVALID_RECOVERY ? 'invalid' : 'unknown')
    })
    return () => { alive.current = false }
  }, [recovery])

  async function submit(event) {
    event.preventDefault()
    if (pending.current || state !== 'ready') return
    if (password.length < 8) { setError('Введите пароль не короче 8 символов.'); return }
    if (password !== confirmation) { setError('Пароли не совпадают.'); return }
    pending.current = true
    setState('saving')
    setError('')
    const result = await recovery.save(password)
    // Clear secrets on both success and failure. Never persist them.
    if (alive.current) {
      setPassword('')
      setConfirmation('')
      setError(result.error || '')
      setState(result.mfa ? 'mfa' : result.terminal ? 'unknown' : result.error === INVALID_RECOVERY ? 'invalid' : result.error ? 'ready' : 'complete')
    }
    pending.current = false
  }
  return <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
    <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
      <h1 className="flex justify-center text-2xl font-bold"><AppBrand /></h1>
      <h2 className="mt-6 text-xl font-semibold">Новый пароль</h2>
      {state === 'checking' && <p role="status">Проверяем ссылку…</p>}
      {state === 'invalid' && <p role="alert">{INVALID_RECOVERY}</p>}
      {state === 'unknown' && <p role="alert">{error}</p>}
      {state === 'complete' && <p role="status">Пароль изменён. Войдите с новым паролем.</p>}
      {state === 'mfa' && <RecoveryMfa recovery={recovery}
        onVerified={() => { setError(''); setState('ready') }}
        onTerminal={message => { setError(message); setState('unknown') }} />}
      {['ready', 'saving'].includes(state) && <form onSubmit={submit} className="mt-5 space-y-3">
        <label className="block">Новый пароль<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="block">Повторите пароль<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <button disabled={state === 'saving'} className="w-full rounded-lg bg-blue-600 p-3 text-white disabled:opacity-50">{state === 'saving' ? 'Сохраняем…' : 'Сохранить пароль'}</button>
      </form>}
      <a className="mt-4 block text-blue-600" href={RECOVERY_LOGIN}>Вернуться ко входу</a>
      {state === 'invalid' && <a className="mt-3 block text-blue-600" href="/login?recovery=request">Запросить новое письмо</a>}
    </div>
  </div>
}
