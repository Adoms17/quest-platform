import { Navigate, useSearchParams } from 'react-router-dom'

// Совместимость старых закладок; общий экран больше не загружает данные.
export default function ParticipantGroup() {
  const [params] = useSearchParams()
  const group = params.get('group')
  const profile = params.get('profile')
  const target = group ? `/participants/group/${encodeURIComponent(group)}`
    : profile ? `/participants/group/profiles/${encodeURIComponent(profile)}`
    : '/participants/group'
  return <Navigate to={target} replace />
}
