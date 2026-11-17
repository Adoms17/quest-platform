import { useState } from 'react'

export default function Login({ auth }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError('')
    try {
      const { error: failure } = await auth.signInWithPassword({ email: values.get('email').trim(), password: values.get('password') })
      if (failure) throw failure
      form.reset()
    } catch { setError('Не удалось войти. Проверьте данные и соединение.') }
    finally { setBusy(false) }
  }
  return <section className="narrow"><h1>Вход для сотрудников</h1><p>Используйте аккаунт с назначенной системной ролью.</p>
    <form onSubmit={submit}><label>Электронная почта<input name="email" type="email" autoComplete="username" required /></label>
      <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button></form>{error && <p role="alert">{error}</p>}
  </section>
}
