import { useState } from 'react'
import { useNavigate } from 'react-router-dom'  // ← добавить
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'

export default function Login({ setSession }) {
  const navigate = useNavigate()  // ← добавить
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignUp = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) toast.error(error.message)
    else toast.success('Проверьте почту или войдите сразу (если подтверждение отключено)')
    setLoading(false)
  }

  const handleSignIn = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
    } else {
      setSession(data.session)
      navigate('/quests')  // ← явный редирект
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded shadow-md w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">Quest Platform</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 border rounded mb-3"
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 border rounded mb-3"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="flex-1 bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
          >
            Регистрация
          </button>
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="flex-1 bg-green-500 text-white p-2 rounded hover:bg-green-600"
          >
            Вход
          </button>
        </div>
      </div>
    </div>
  )
}