const STABLE_IDENTITY_EVENTS = new Set(['SIGNED_IN', 'TOKEN_REFRESHED'])

export function selectAuthSession(currentSession, nextSession, event) {
  const currentUserId = currentSession?.user?.id
  const nextUserId = nextSession?.user?.id

  if (
    STABLE_IDENTITY_EVENTS.has(event) &&
    currentUserId &&
    currentUserId === nextUserId
  ) {
    return currentSession
  }

  return nextSession
}
