import { Navigate, useLocation } from 'react-router-dom'
import Login from '../pages/Login'
import { getLoginDestination } from '../services/appNavigation'

export default function LoginEntry({ session, setSession }) {
  const location = useLocation()
  const recovery = new URLSearchParams(location.search).get('recovery')
  if (!session || ['complete', 'request'].includes(recovery)) return <Login setSession={setSession} />
  return <Navigate to={getLoginDestination(location.state?.from, session.user.id)} replace />
}
