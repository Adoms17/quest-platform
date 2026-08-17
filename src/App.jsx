import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import ProtectedRoute from './components/ProtectedRoute'
import AppToaster from './components/Toaster'
import Navbar from './components/Navbar'

const Login = lazy(() => import('./pages/Login'))
const QuestList = lazy(() => import('./pages/QuestList'))
const QuestCreate = lazy(() => import('./pages/QuestCreate'))
const QuestEdit = lazy(() => import('./pages/QuestEdit'))
const QuestPlay = lazy(() => import('./pages/QuestPlay'))
const QuestStats = lazy(() => import('./pages/QuestStats'))
const Downloads = lazy(() => import('./pages/Downloads'))
const TaskManager = lazy(() => import('./pages/TaskManager'))
const TaskForm = lazy(() => import('./pages/TaskForm'))

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

  useEffect(() => {
    const handleOnline = () => {
      if (!session) return // если нет сессии, синхронизация не нужна
      import('./services/sync').then(({ syncPendingResultsWithRetry }) => {
        syncPendingResultsWithRetry(session).catch(err => console.error('Синхронизация не удалась:', err))
      })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [session]) // <-- добавили session

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Загрузка...</div>
  }

  // Обёртка для страниц с навигацией
  function Layout({ children }) {
    return (
      <>
        <Navbar session={session} />
        <main>{children}</main>
      </>
    )
  }

  return (
    <BrowserRouter>
      <AppToaster />
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Загрузка...</div>}>
        <Routes>
        <Route path="/login" element={<Login setSession={setSession} />} />
        <Route
          path="/quests"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <QuestList session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/new"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <QuestCreate session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/edit"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <QuestEdit session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/stats"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <QuestStats session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/play/:id"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <QuestPlay session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/downloads"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <Downloads session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/tasks"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <TaskManager session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/tasks/new"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <TaskForm session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/tasks/:taskId/edit"
          element={
            <ProtectedRoute session={session}>
              <Layout>
                <TaskForm session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={session ? '/quests' : '/login'} />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App