import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import ProtectedRoute from './components/ProtectedRoute'
import AppToaster from './components/Toaster'
import Navbar from './components/Navbar'
import LazyRouteErrorBoundary from './components/LazyRouteErrorBoundary'
import { selectAuthSession } from './services/authSession'
import { isTransportError } from './services/network'
import { createSyncCoordinator } from './services/syncCoordinator'
import { PENDING_RESULT_ENQUEUED_EVENT } from './services/syncSignals'

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

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
    setSession(currentSession =>
      selectAuthSession(currentSession, nextSession, event)
    )
  })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    const coordinator = createSyncCoordinator({
      isOnline: () => navigator.onLine,
      isRetryableError: isTransportError,
      onError: error => {
        console.error('Синхронизация не удалась:', error)
      },
      runSync: async () => {
        const { syncPendingResultsWithRetry } =
          await import('./services/sync')

        return syncPendingResultsWithRetry(session, 1, {
          suppressErrorToast: true,
        })
      },
    })

    const handleOnline = () => coordinator.triggerImmediately()
    const handleFocus = () => void coordinator.trigger()
    const handlePending = () => coordinator.requestPendingSync()

    handleOnline()

    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener(PENDING_RESULT_ENQUEUED_EVENT, handlePending)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(
        PENDING_RESULT_ENQUEUED_EVENT,
        handlePending
      )
      coordinator.stop()
    }
  }, [session])

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
      <LazyRouteErrorBoundary>
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
      </LazyRouteErrorBoundary>
    </BrowserRouter>
  )
}

export default App
