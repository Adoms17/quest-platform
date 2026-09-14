import { useSearchParams } from 'react-router-dom'
import ParticipantDashboard from '../components/ParticipantDashboard'

export default function ParticipantQuests({ session, home = false }) {
  const [params] = useSearchParams()
  const requestedProfile = params.get('participant') || ''
  return <ParticipantDashboard key={`${session?.user?.id}:${home}:${requestedProfile}`} requestedProfile={requestedProfile} userId={session?.user?.id} home={home} />
}
