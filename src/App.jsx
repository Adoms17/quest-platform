import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'
import ProtectedRoute from './components/ProtectedRoute'
import AppToaster from './components/Toaster'
import Navbar from './components/Navbar'
import LazyRouteErrorBoundary from './components/LazyRouteErrorBoundary'
import { selectAuthSession } from './services/authSession'
import { isTransportError } from './services/network'
import { createSyncCoordinator } from './services/syncCoordinator'
import { PENDING_RESULT_ENQUEUED_EVENT } from './services/syncSignals'
import { OrganizationProvider } from './contexts/OrganizationContext'
import {
  clearParticipantMode,
  getParticipantModeLock,
  PARTICIPANT_MODE_CHANGED_EVENT,
} from './services/participantMode'
import ParticipantModeBar from './components/ParticipantModeBar'

const Login = lazy(() => import('./pages/Login'))
const QuestList = lazy(() => import('./pages/QuestList'))
const QuestCreate = lazy(() => import('./pages/QuestCreate'))
const QuestEdit = lazy(() => import('./pages/QuestEdit'))
const QuestPlay = lazy(() => import('./pages/QuestPlay'))
const QuestStats = lazy(() => import('./pages/QuestStats'))
const Downloads = lazy(() => import('./pages/Downloads'))
const TaskManager = lazy(() => import('./pages/TaskManager'))
const TaskForm = lazy(() => import('./pages/TaskForm'))
const OrganizationTeam = lazy(() => import('./pages/OrganizationTeam'))
const AcceptOrganizationInvitation = lazy(() => import('./pages/AcceptOrganizationInvitation'))
const QuestAccess = lazy(() => import('./pages/QuestAccess'))
const RedeemQuestAccess = lazy(() => import('./pages/RedeemQuestAccess'))
const RedeemQuestCode = lazy(() => import('./pages/RedeemQuestCode'))
const ParticipantGroup = lazy(() => import('./pages/ParticipantGroup'))
const AcceptParticipantInvitation = lazy(() => import('./pages/AcceptParticipantInvitation'))
const ParticipantHistory = lazy(() => import('./pages/ParticipantHistory'))

function Layout({ children, session }) {
  const location = useLocation()
  const [participantMode, setParticipantMode] = useState(() => getParticipantModeLock())

  useEffect(() => {
    const refresh = () => setParticipantMode(getParticipantModeLock())
    window.addEventListener(PARTICIPANT_MODE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PARTICIPANT_MODE_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (participantMode && participantMode.actorUserId !== session?.user?.id) {
      clearParticipantMode()
    }
  }, [participantMode, session])

  if (participantMode?.actorUserId === session?.user?.id) {
    const questPath = `/play/${participantMode.questId}`
    if (location.pathname !== questPath) {
      return <Navigate to={`${questPath}?participant=${encodeURIComponent(participantMode.participantProfileId)}`} replace />
    }
  }

  return (
    <>
      {participantMode
        ? <ParticipantModeBar lock={participantMode} />
        : <Navbar session={session} />}
      <main>{children}</main>
    </>
  )
}

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

  return (
    <BrowserRouter>
      <AppToaster />
      <OrganizationProvider session={session}>
        <LazyRouteErrorBoundary>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Загрузка...</div>}>
          <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <Navigate to="/quests" replace />
            ) : (
              <Login setSession={setSession} />
            )
          }
        />
        <Route
          path="/quests"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <QuestList session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/new"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <QuestCreate session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/edit"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <QuestEdit session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/stats"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <QuestStats session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/play/:id"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <QuestPlay session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/downloads"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <Downloads session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/tasks"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <TaskManager session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/tasks/new"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <TaskForm session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invitations/accept"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <AcceptOrganizationInvitation />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/organization/team"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <OrganizationTeam />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/access"
          element={<ProtectedRoute session={session}><Layout session={session}><QuestAccess /></Layout></ProtectedRoute>}
        />
        <Route
          path="/access/redeem"
          element={<ProtectedRoute session={session}><Layout session={session}><RedeemQuestAccess /></Layout></ProtectedRoute>}
        />
        <Route
          path="/access/code"
          element={<ProtectedRoute session={session}><Layout session={session}><RedeemQuestCode /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantGroup /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/invitations/accept"
          element={<ProtectedRoute session={session}><Layout session={session}><AcceptParticipantInvitation session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/history"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantHistory /></Layout></ProtectedRoute>}
        />
        <Route
          path="/quests/:id/tasks/:taskId/edit"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <TaskForm session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={session ? '/quests' : '/login'} />} />
          </Routes>
        </Suspense>
        </LazyRouteErrorBoundary>
      </OrganizationProvider>
    </BrowserRouter>
  )
}

export default App
