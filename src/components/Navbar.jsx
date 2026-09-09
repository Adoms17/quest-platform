import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'

export default function Navbar({ session }) {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [personalProfileName, setPersonalProfileName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const {
    organizations,
    currentOrganization,
    loadingOrganizations,
    organizationError,
    selectOrganization,
  } = useOrganization()
  const canManageTeam = hasOrganizationPermission(currentOrganization, 'members.manage')

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
        const { data: participantProfiles, error: participantError } = await supabase.rpc('get_my_participant_profiles')
        if (participantError) throw participantError
        setPersonalProfileName(participantProfiles?.find(item => item.relationship === 'self')?.display_name || '')
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err)
      } finally {
        setLoading(false)
      }
    }
    void fetchProfile()
    window.addEventListener('participant-profile-updated', fetchProfile)
    return () => window.removeEventListener('participant-profile-updated', fetchProfile)
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
  const displayName = personalProfileName || profile?.username || session?.user?.email?.split('@')[0] || 'Пользователь'
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
    <nav className="bg-blue-600 text-white p-4 shadow-sm flex justify-between items-center">
      {/* Левый блок: логотип и имя пользователя (на больших экранах) */}
      <div className="flex items-center gap-4">
        <Link to="/quests" className="text-xl font-bold hover:underline">
          🧭 Quest Platform
        </Link>
        <span className="hidden sm:inline text-sm opacity-80">
          {loading ? '...' : displayName}
        </span>
        <Link to="/downloads" className="block rounded-sm px-4 py-2 hover:bg-blue-700">
          📥 Мои загрузки
        </Link>
        <Link to="/access/code" className="hidden sm:block px-3 py-2 hover:bg-blue-700 rounded-sm">
          🔑 Ввести код
        </Link>
        <Link to="/participants/group" className="hidden sm:block px-3 py-2 hover:bg-blue-700 rounded-sm">
          👨‍👩‍👧 Мои группы
        </Link>
        <Link to="/participants/history" className="hidden lg:block px-3 py-2 hover:bg-blue-700 rounded-sm">
          📊 История
        </Link>
        {canManageTeam && (
          <Link to="/organization/team" className="hidden sm:block px-3 py-2 hover:bg-blue-700 rounded-sm">
            👥 Команда
          </Link>
        )}
        {organizations.length > 0 && (
          <label className="hidden md:flex items-center gap-2 text-sm">
            <span className="sr-only">Текущая организация</span>
            <select
              aria-label="Текущая организация"
              value={currentOrganization?.id || ''}
              disabled={loadingOrganizations}
              onChange={event => selectOrganization(event.target.value)}
              className="max-w-56 rounded-sm border border-blue-400 bg-blue-700 px-2 py-1 text-white"
            >
              {organizations.map(organization => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                  {' · '}
                  {organization.personal_owner_id === session.user.id
                    ? 'личная'
                    : 'по приглашению'}
                </option>
              ))}
            </select>
          </label>
        )}
        {organizationError && (
          <span className="hidden lg:inline text-xs text-yellow-200">
            Организации недоступны
          </span>
        )}
      </div>

      {/* Правый блок: аватар + выпадающее меню */}
      <div className="relative user-menu">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 focus:outline-hidden"
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
          <div className="absolute right-0 mt-2 w-48 bg-white text-gray-800 rounded-sm shadow-lg py-1 z-10">
            <div className="px-4 py-2 border-b">
              <p className="font-medium">{displayName}</p>
              <p className="text-xs text-gray-500 truncate">{session.user.email}</p>
            </div>
            {canManageTeam && (
              <Link
                to="/organization/team"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2 hover:bg-gray-100 transition"
              >
                👥 Команда
              </Link>
            )}
            <Link
              to="/participants/group"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 hover:bg-gray-100 transition"
            >
              👨‍👩‍👧 Мои группы
            </Link>
            <Link
              to="/participants/history"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 hover:bg-gray-100 transition"
            >
              📊 История
            </Link>
            <Link
              to="/access/code"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 hover:bg-gray-100 transition sm:hidden"
            >
              🔑 Ввести код
            </Link>
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
