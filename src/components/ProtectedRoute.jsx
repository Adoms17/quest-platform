import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ children, session }) {
  if (!session) {
    // Если сессии нет, перенаправляем на логин
    return <Navigate to="/login" replace />
  }
  return children
}