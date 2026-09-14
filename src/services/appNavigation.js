export function isOrganizationPath(pathname) {
  return /^\/(quests|organization)(\/|$)/.test(pathname) || pathname === '/invitations/accept'
}

export function rememberAppContext(userId, context) {
  if (!userId || !['participant', 'organization'].includes(context)) return
  try { localStorage.setItem(`qvesta:context:${userId}`, context) } catch { /* Навигация доступна без хранилища. */ }
}

export function getAppEntry(userId) {
  try {
    if (userId && localStorage.getItem(`qvesta:context:${userId}`) === 'organization') return '/quests'
  } catch { /* Начальный контекст участника. */ }
  return '/home'
}

export function getLoginDestination(returnPath, userId) {
  return typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.startsWith('//') && !returnPath.includes('\\') && returnPath !== '/login'
    ? returnPath : getAppEntry(userId)
}
