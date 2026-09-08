import { useEffect, useState } from 'react'
import { listMyParticipantProfiles } from '../services/participantGroupApi'

export default function ParticipantProfileSelect({ value, onChange, onProfilesLoaded, label = 'Кто будет проходить квест?' }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = setTimeout(() => {
      void listMyParticipantProfiles().then(items => {
        if (!active) return
        const available = items.filter(item =>
          item.relationship === 'self' || item.supervision_status === 'active'
        )
        setProfiles(available)
        onProfilesLoaded?.(available)
        if (!value && available[0]) onChange(available[0].participant_profile_id, available[0])
      }).catch(() => {
        if (active) setError(true)
      }).finally(() => {
        if (active) setLoading(false)
      })
    }, 0)
    return () => { active = false; clearTimeout(timeout) }
  }, [onChange, onProfilesLoaded, value])

  return <label className="block"><span className="font-medium">{label}</span><select aria-label={label} required disabled={loading || error} value={value} onChange={event => { const profile = profiles.find(item => item.participant_profile_id === event.target.value); onChange(event.target.value, profile) }} className="mt-1 w-full rounded-lg border p-3"><option value="">{loading ? 'Загрузка профилей...' : error ? 'Профили недоступны' : 'Выберите участника'}</option>{profiles.map(profile => <option key={profile.participant_profile_id} value={profile.participant_profile_id}>{profile.display_name}{profile.relationship === 'self' ? ' · мой профиль' : ''}</option>)}</select>{error && <span className="mt-1 block text-sm text-red-700">Не удалось загрузить профили участников.</span>}</label>
}
