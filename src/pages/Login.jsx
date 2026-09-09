import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { getAuthErrorMessage, logAuthError } from '../services/authErrors'
import { withAuthTimeout } from '../services/authRequest'

export default function Login({ setSession }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)

  const switchMode = nextMode => {
    setMode(nextMode)
    setPasswordConfirmation('')
  }

  const handleSubmit = async event => {
    event.preventDefault()
    if (!email.trim() || !password) {
      toast.error('Введите email и пароль.')
      return
    }
    if (mode === 'signup' && !name.trim()) {
      toast.error('Введите имя.')
      return
    }
    if (mode === 'signup' && password !== passwordConfirmation) {
      toast.error('Пароли не совпадают.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error } = await withAuthTimeout(supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: name.trim() } },
        }))
        if (error) {
          logAuthError('Ошибка регистрации', error)
          toast.error(getAuthErrorMessage(error))
          return
        }
        toast.success('Проверьте почту или войдите сразу, если подтверждение email отключено.')
        switchMode('signin')
        return
      }

      const { data, error } = await withAuthTimeout(supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      }))
      if (error) {
        logAuthError('Ошибка входа', error)
        toast.error(getAuthErrorMessage(error))
        return
      }
      setSession(data.session)
      const returnPath = location.state?.from
      navigate(typeof returnPath === 'string' && returnPath.startsWith('/') ? returnPath : '/quests')
    } catch (error) {
      logAuthError(mode === 'signup' ? 'Ошибка регистрации' : 'Ошибка входа', error)
      toast.error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="text-center text-2xl font-bold">Quest Platform</h1>
        <div className="mt-6 grid grid-cols-2 rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Режим авторизации">
          <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => switchMode('signin')} className={`rounded-md px-3 py-2 ${mode === 'signin' ? 'bg-white font-medium shadow-sm' : 'text-gray-600'}`}>Вход</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')} className={`rounded-md px-3 py-2 ${mode === 'signup' ? 'bg-white font-medium shadow-sm' : 'text-gray-600'}`}>Регистрация</button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-3">
          {mode === 'signup' && <label className="block"><span className="text-sm font-medium">Имя</span><input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>}
          <label className="block"><span className="text-sm font-medium">Email</span><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
          <label className="block"><span className="text-sm font-medium">Пароль</span><input required type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
          {mode === 'signup' && <label className="block"><span className="text-sm font-medium">Повторите пароль</span><input required type="password" autoComplete="new-password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>}
          <button disabled={loading} className="w-full rounded-lg bg-blue-600 p-3 text-white hover:bg-blue-700 disabled:opacity-50">{loading ? 'Подождите…' : mode === 'signup' ? 'Зарегистрироваться' : 'Войти'}</button>
        </form>
      </div>
    </div>
  )
}
