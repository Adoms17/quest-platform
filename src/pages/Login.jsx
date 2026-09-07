import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import { getAuthErrorMessage, logAuthError } from '../services/authErrors'
import { withAuthTimeout } from '../services/authRequest'

export default function Login({ setSession }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const validateCredentials = () => {
    if (!email.trim() || !password) {
      toast.error('Введите email и пароль.')
      return false
    }
    return true
  }

  const handleSignUp = async () => {
    if (!validateCredentials()) return
    setLoading(true)
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.signUp({ email: email.trim(), password }),
      )
      if (error) {
        logAuthError('Ошибка регистрации', error)
        toast.error(getAuthErrorMessage(error))
        return
      }

      toast.success(
        'Проверьте почту или войдите сразу, если подтверждение email отключено.',
      )
    } catch (error) {
      logAuthError('Ошибка регистрации', error)
      toast.error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleSignIn = async () => {
    if (!validateCredentials()) return
    setLoading(true)
    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
      )
      if (error) {
        logAuthError('Ошибка входа', error)
        toast.error(getAuthErrorMessage(error))
        return
      }

      setSession(data.session)
      const returnPath = location.state?.from
      navigate(typeof returnPath === 'string' && returnPath.startsWith('/') ? returnPath : '/quests')
    } catch (error) {
      logAuthError('Ошибка входа', error)
      toast.error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-sm shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">Quest Platform</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full p-2 border rounded-sm mb-3"
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full p-2 border rounded-sm mb-3"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="flex-1 bg-blue-500 text-white p-2 rounded-sm hover:bg-blue-600"
          >
            {loading ? 'Подождите…' : 'Регистрация'}
          </button>
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="flex-1 bg-green-500 text-white p-2 rounded-sm hover:bg-green-600"
          >
            {loading ? 'Подождите…' : 'Вход'}
          </button>
        </div>
      </div>
    </div>
  )
}
