import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'

export default function Navbar({ session }) {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  // Загружаем профиль пользователя
  useEffect(() => {
    async function fetchProfile() {
      if (!session?.user?.id) {
        setLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', session.user.id)
          .single()
        if (error) throw error
        setProfile(data)
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [session])

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error('Ошибка выхода: ' + error.message)
    } else {
      toast.success('Вы вышли')
      navigate('/login')
    }
  }

  // Отображаемое имя: username или email или 'Пользователь'
  const displayName = profile?.username || session?.user?.email?.split('@')[0] || 'Пользователь'
  const avatarUrl = profile?.avatar_url || null

  // Закрываем меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuOpen && !e.target.closest('.user-menu')) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [menuOpen])

  // Если нет сессии — не показываем навбар (но по логике он только для авторизованных)
  if (!session) return null

  return (
    <nav className="bg-blue-600 text-white p-4 shadow flex justify-between items-center">
      {/* Левый блок: логотип и имя пользователя (на больших экранах) */}
      <div className="flex items-center gap-4">
        <Link to="/quests" className="text-xl font-bold hover:underline">
          🧭 Quest Platform
        </Link>
        <span className="hidden sm:inline text-sm opacity-80">
          {loading ? '...' : displayName}
        </span>
        <Link to="/downloads" className="block px-4 py-2 hover:bg-gray-100">
          📥 Мои загрузки
        </Link>
      </div>

      {/* Правый блок: аватар + выпадающее меню */}
      <div className="relative user-menu">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 focus:outline-none"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Аватар"
              className="w-8 h-8 rounded-full border-2 border-white"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center text-white text-sm font-bold">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="hidden sm:inline text-sm">{displayName}</span>
          <svg
            className={`w-4 h-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Выпадающее меню */}
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-white text-gray-800 rounded shadow-lg py-1 z-10">
            <div className="px-4 py-2 border-b">
              <p className="font-medium">{displayName}</p>
              <p className="text-xs text-gray-500 truncate">{session.user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="block w-full text-left px-4 py-2 hover:bg-gray-100 transition"
            >
              🚪 Выйти
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}