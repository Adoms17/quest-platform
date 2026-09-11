export function getParticipantProfileIdentity(profile) {
  if (profile?.account_email) {
    return profile.account_email
  }

  if (profile?.owner_email) {
    const ownerName = profile.owner_username || 'Пользователь'
    return `владелец: ${ownerName} · ${profile.owner_email}`
  }

  return profile?.relationship === 'self' ? 'мой профиль' : ''
}

export function formatParticipantProfileLabel(profile) {
  const identity = getParticipantProfileIdentity(profile)
  return [profile?.display_name || 'Профиль', identity].filter(Boolean).join(' · ')
}

export function sortParticipantProfiles(profiles = []) {
  return [...profiles].sort((left, right) => {
    const leftIsPersonal = left?.relationship === 'self' || left?.is_current_user === true
    const rightIsPersonal = right?.relationship === 'self' || right?.is_current_user === true
    if (leftIsPersonal !== rightIsPersonal) return leftIsPersonal ? -1 : 1

    const labelOrder = formatParticipantProfileLabel(left).localeCompare(
      formatParticipantProfileLabel(right),
      'ru',
      { sensitivity: 'base' },
    )
    if (labelOrder !== 0) return labelOrder
    return String(left?.participant_profile_id || '').localeCompare(String(right?.participant_profile_id || ''))
  })
}
