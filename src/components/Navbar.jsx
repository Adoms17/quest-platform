import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import { getUserErrorMessage } from '../services/userErrorMessage'
import { loadAccountProfile } from '../services/accountProfile'
import { isOrganizationPath, rememberAppContext } from '../services/appNavigation'
import AppBrand from './AppBrand'
import AppIcon from './AppIcon'

export default function Navbar({ session }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const userId = session?.user?.id
  const [account, setAccount] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [organizationSearch, setOrganizationSearch] = useState('')
  const menuRef = useRef(null)
  const buttonRef = useRef(null)
  const { organizations, currentOrganization, loadingOrganizations, organizationError, selectOrganization } = useOrganization()
  const organizationContext = isOrganizationPath(pathname)
  const canManageTeam = hasOrganizationPermission(currentOrganization, 'members.manage')

  useEffect(() => {
    if (!userId) return
    let active = true
    let request = 0
    const refresh = async () => {
      const version = ++request
      try {
        const profile = await loadAccountProfile(userId)
        if (active && version === request) setAccount({ userId, ...profile })
      } catch { /* Имя аккаунта доступно и без сети. */ }
    }
    void refresh()
    window.addEventListener('participant-profile-updated', refresh)
    return () => { active = false; window.removeEventListener('participant-profile-updated', refresh) }
  }, [userId])

  useEffect(() => {
    if (!menuOpen) return
    const outside = event => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    const escape = event => {
      if (event.key === 'Escape') { setMenuOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOpen])

  if (!session) return null
  const profile = account?.userId === userId ? account : null
  const displayName = profile?.displayName || session.user.email?.split('@')[0] || 'Мой профиль'
  const contextName = organizationContext ? currentOrganization?.name || 'Организация' : displayName
  const closeMenu = () => { setMenuOpen(false); setOrganizationSearch('') }
  const switchContext = organization => {
    if (organization) selectOrganization(organization.id)
    rememberAppContext(userId, organization ? 'organization' : 'participant')
    closeMenu()
    navigate(organization ? '/quests' : '/home')
  }
  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) toast.error(getUserErrorMessage(error, 'Не удалось выйти из аккаунта.'))
    else { closeMenu(); navigate('/login') }
  }
  const links = organizationContext
    ? [{ to: '/quests', label: 'Квесты', icon: 'map' }, ...(canManageTeam ? [{ to: '/organization/team', label: 'Команда', icon: 'users' }] : [])]
    : [{ to: '/home', label: 'Главная', icon: 'home' }, { to: '/my-quests', label: 'Квесты', icon: 'map' }, { to: '/participants/group', label: 'Люди', icon: 'users' }]
  const navigation = links.map(link => <NavLink key={link.to} to={link.to} className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}><AppIcon name={link.icon} /><span>{link.label}</span></NavLink>)
  const filteredOrganizations = organizations.filter(item => item.name.toLocaleLowerCase().includes(organizationSearch.trim().toLocaleLowerCase()))
  return <>
    <header className="app-header">
      <Link to={organizationContext ? '/quests' : '/home'} className="app-brand-link" aria-label="Квеста — главная"><AppBrand compact /></Link>
      <nav className="app-desktop-nav" aria-label="Основная навигация">{navigation}</nav>
      <div className="app-context" ref={menuRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu() }}>
        <button type="button" ref={buttonRef} className="app-context-trigger" aria-label={`Открыть меню профиля: ${contextName}`} aria-expanded={menuOpen} aria-controls="app-context-menu" onClick={() => setMenuOpen(value => !value)}>
          {!organizationContext && profile?.avatar_url ? <img className="app-avatar" src={profile.avatar_url} alt="" /> : <span className="app-avatar">{contextName.slice(0, 1).toUpperCase()}</span>}
          <span className="app-context-name">{contextName}</span><AppIcon name="chevron-down" />
        </button>
        {menuOpen && <div id="app-context-menu" className="app-context-menu">
          <p className="app-menu-heading">Выбрать профиль или организацию</p>
          <button className="app-menu-item" onClick={() => switchContext(null)} aria-current={!organizationContext ? 'true' : undefined}>{displayName}<small>Личный профиль</small></button>
          {loadingOrganizations && <p className="app-menu-heading" role="status">Загружаем организации…</p>}
          {organizationError && <p className="app-menu-heading" role="status">Организации недоступны. Обновите страницу при подключении к сети.</p>}
          {organizations.length > 5 && <label className="app-org-search">Найти организацию<input value={organizationSearch} onChange={event => setOrganizationSearch(event.target.value)} type="search" /></label>}
          <div className="app-org-list">
            {filteredOrganizations.map(item => <button key={item.id} className="app-menu-item" aria-current={organizationContext && currentOrganization?.id === item.id ? 'true' : undefined} onClick={() => switchContext(item)}>{item.name}</button>)}
            {organizationSearch && filteredOrganizations.length === 0 && <p className="app-menu-heading">Ничего не найдено</p>}
          </div>
          <div className="app-menu-secondary">
            <Link className="app-menu-item" to="/participants/history" onClick={closeMenu}>История прохождений</Link>
            <Link className="app-menu-item" to="/downloads" onClick={closeMenu}>Хранилище</Link>
            <Link className="app-menu-item" to="/access/code" onClick={closeMenu}>Ввести код</Link>
            <button className="app-menu-item" onClick={logout}>Выйти</button>
          </div>
        </div>}
      </div>
    </header>
    {!pathname.startsWith('/play/') && <nav className="app-mobile-nav" aria-label="Мобильная навигация">{navigation}</nav>}
  </>
}
