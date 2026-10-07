import { useEffect, useState } from 'react'
import { loadAvailableParticipantProfiles } from '../services/participantProfileAccess'
import { formatParticipantProfileLabel } from '../services/participantProfileLabels'

export default function ParticipantProfileSelect(props) {
  return <ProfileSelect key={props.userId || 'anonymous'} {...props} />
}

function ProfileSelect({ value, onChange, onProfilesLoaded, userId, label = 'Кто будет проходить квест?' }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [usingOfflineProfiles, setUsingOfflineProfiles] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      void (async () => {
        let available = []
        let offline = false

        try {
          const result = await loadAvailableParticipantProfiles(userId, { signal: controller.signal })
          available = result.profiles
          offline = result.offline
        } catch {
          offline = true
        }

        if (!active) return
        setProfiles(available)
        setUsingOfflineProfiles(offline && available.length > 0)
        setError(offline && available.length === 0)
        onProfilesLoaded?.(available)
        if (!value && available[0]) onChange(available[0].participant_profile_id, available[0])
      })().finally(() => {
        if (active) setLoading(false)
      })
    }, 0)
    return () => { active = false; controller.abort(); clearTimeout(timeout) }
  }, [onChange, onProfilesLoaded, userId, value])

  return <label className="block"><span className="font-medium">{label}</span><select aria-label={label} required disabled={loading || error} value={value} onChange={event => { const profile = profiles.find(item => item.participant_profile_id === event.target.value); onChange(event.target.value, profile) }} className="mt-1 w-full rounded-lg border p-3"><option value="">{loading ? 'Загрузка профилей...' : error ? 'Профили недоступны' : 'Выберите участника'}</option>{profiles.map(profile => <option key={profile.participant_profile_id} value={profile.participant_profile_id}>{formatParticipantProfileLabel(profile)}</option>)}</select>{usingOfflineProfiles && <span className="mt-1 block text-sm text-gray-600">Профили загружены из локальной копии.</span>}{error && <span className="mt-1 block text-sm text-red-700">Профили не сохранены на этом устройстве. Подключитесь к интернету один раз.</span>}</label>
}
