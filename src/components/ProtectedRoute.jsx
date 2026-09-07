import { Navigate, useLocation } from 'react-router-dom'

export default function ProtectedRoute({ children, session }) {
  const location = useLocation()
  if (!session) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return children
}
