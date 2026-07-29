import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import QuestList from './pages/QuestList'
import QuestCreate from './pages/QuestCreate'
import QuestEdit from './pages/QuestEdit'
import ProtectedRoute from './components/ProtectedRoute'
import Loader from './components/Loader'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <Loader text="Вход в систему..." />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login setSession={setSession} />} />
        <Route
          path="/quests"
          element={
            <ProtectedRoute session={session}>
              <QuestList session={session} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/new"
          element={
            <ProtectedRoute session={session}>
              <QuestCreate session={session} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/edit"
          element={
            <ProtectedRoute session={session}>
              <QuestEdit session={session} />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={session ? '/quests' : '/login'} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App