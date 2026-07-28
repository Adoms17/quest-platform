import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignUp = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
    console.error('Ошибка регистрации:', error) // <-- добавить эту строку
    alert(error.message)
    }
    else alert('Проверьте почту для подтверждения!')
    setLoading(false)
  }

  const handleSignIn = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
    console.error('Ошибка авторизации:', error) // <-- добавить эту строку
    alert(error.message)
  }
    else alert('Добро пожаловать!')
    setLoading(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (session) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold text-green-600">✅ Всё работает!</h1>
        <p className="mt-2">Вы вошли как: <strong>{session.user.email}</strong></p>
        <button 
          onClick={handleSignOut}
          className="mt-4 bg-red-500 text-white px-4 py-2 rounded"
        >
          Выйти
        </button>
      </div>
    )
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
            Зарегистрироваться
          </button>
          <button 
            onClick={handleSignIn} 
            disabled={loading}
            className="flex-1 bg-green-500 text-white p-2 rounded hover:bg-green-600"
          >
            Войти
          </button>
        </div>
      </div>
    </div>
  )
}

export default App