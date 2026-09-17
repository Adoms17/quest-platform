import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useMatch } from 'react-router-dom'
import { supabase } from './supabaseClient'
import ProtectedRoute from './components/ProtectedRoute'
import AppToaster from './components/Toaster'
import Navbar from './components/Navbar'
import QuestWorkspaceNav from './components/QuestWorkspaceNav'
import { getAppEntry, getLoginDestination } from './services/appNavigation'
import LazyRouteErrorBoundary from './components/LazyRouteErrorBoundary'
import { selectAuthSession } from './services/authSession'
import { isTransportError } from './services/network'
import { createSyncCoordinator } from './services/syncCoordinator'
import { measureOperation, recordOfflineMetric } from './services/operationTiming'
import { PENDING_RESULT_ENQUEUED_EVENT } from './services/syncSignals'
import { OrganizationProvider } from './contexts/OrganizationContext'
import {
  clearParticipantMode,
  getParticipantModeLock,
  PARTICIPANT_MODE_CHANGED_EVENT,
} from './services/participantMode'
import ParticipantModeBar from './components/ParticipantModeBar'

const ParticipantQuests = lazy(() => import('./pages/ParticipantQuests'))
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
const OrganizationBilling = lazy(() => import('./pages/OrganizationBilling'))
const AcceptOrganizationInvitation = lazy(() => import('./pages/AcceptOrganizationInvitation'))
const QuestAccess = lazy(() => import('./pages/QuestAccess'))
const RedeemQuestAccess = lazy(() => import('./pages/RedeemQuestAccess'))
const RedeemQuestCode = lazy(() => import('./pages/RedeemQuestCode'))
const ParticipantGroupMembers = lazy(() => import('./pages/ParticipantGroupMembers'))
const ParticipantProfileCard = lazy(() => import('./pages/ParticipantProfileCard'))
const ParticipantProfileCreate = lazy(() => import('./pages/ParticipantProfileCreate'))
const ParticipantGroupCreate = lazy(() => import('./pages/ParticipantGroupCreate'))
const ParticipantAudit = lazy(() => import('./pages/ParticipantAudit'))
const ParticipantArchive = lazy(() => import('./pages/ParticipantArchive'))
const ParticipantSupervisionProfiles = lazy(() => import('./pages/ParticipantSupervisionProfiles'))
const ParticipantSupervisors = lazy(() => import('./pages/ParticipantSupervisors'))
const ParticipantProfileInvitations = lazy(() => import('./pages/ParticipantProfileInvitations'))
const ParticipantGroupInvitations = lazy(() => import('./pages/ParticipantGroupInvitations'))
const PeopleCatalog = lazy(() => import('./pages/PeopleCatalog'))
const ParticipantGroup = lazy(() => import('./pages/ParticipantGroup'))
const AcceptParticipantInvitation = lazy(() => import('./pages/AcceptParticipantInvitation'))
const ParticipantHistory = lazy(() => import('./pages/ParticipantHistory'))
const AcceptParticipantGroupInvitation = lazy(() => import('./pages/AcceptParticipantGroupInvitation'))

function Layout({ children, session }) {
  const location = useLocation()
  const questRoute = useMatch('/quests/:id/:section')
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
        : <Navbar key={session?.user?.id} session={session} />}
      <main className={!participantMode && !location.pathname.startsWith('/play/') ? 'app-main' : undefined}>
        {!participantMode && questRoute && ['edit', 'tasks', 'access', 'stats'].includes(questRoute.params.section) && <QuestWorkspaceNav key={`${session?.user?.id}:${location.pathname}`} questId={questRoute.params.id} />}
        {children}
      </main>
    </>
  )
}

function LoginRedirect({ session }) {
  const location = useLocation()
  return <Navigate to={getLoginDestination(location.state?.from, session.user.id)} replace />
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

        try {
          const result = await measureOperation(
            'background-sync-pending-results',
            () => syncPendingResultsWithRetry(session, 1, {
              suppressErrorToast: true,
            }),
          )
          recordOfflineMetric(
            'sync-result',
            result.syncedEvents > 0 ? 'success' : 'nothing-to-sync',
          )
          return result
        } catch (error) {
          recordOfflineMetric('sync-result', 'error')
          throw error
        }
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
      <OrganizationProvider key={session?.user?.id || 'anonymous'} session={session}>
        <LazyRouteErrorBoundary>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Загрузка...</div>}>
          <Routes>
        <Route path="/home" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantQuests key={session?.user?.id} session={session} home /></Layout></ProtectedRoute>} />
        <Route path="/my-quests" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantQuests key={session?.user?.id} session={session} /></Layout></ProtectedRoute>} />
        <Route
          path="/login"
          element={
            session ? (
              <LoginRedirect session={session} />
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
          path="/organization/billing"
          element={<ProtectedRoute session={session}><Layout session={session}><OrganizationBilling session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/organization/team"
          element={
            <ProtectedRoute session={session}>
              <Layout session={session}>
                <OrganizationTeam session={session} />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quests/:id/access"
          element={<ProtectedRoute session={session}><Layout session={session}><QuestAccess session={session} /></Layout></ProtectedRoute>}
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
          element={<ProtectedRoute session={session}><Layout session={session}><PeopleCatalog key={session?.user?.id} session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group/create-group"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantGroupCreate key={session?.user?.id} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group/create"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantProfileCreate key={session?.user?.id} session={session} /></Layout></ProtectedRoute>}
        />
        <Route path="/participants/group/archive" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantArchive key={session?.user?.id} session={session} /></Layout></ProtectedRoute>} />
        <Route path="/participants/group/supervision" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantSupervisionProfiles key={session?.user?.id} session={session} /></Layout></ProtectedRoute>} />
        <Route path="/participants/group/profiles/:profileId/audit" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantAudit session={session} /></Layout></ProtectedRoute>} />
        <Route path="/participants/group/profiles/:profileId/supervisors" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantSupervisors session={session} /></Layout></ProtectedRoute>} />
        <Route path="/participants/group/profiles/:profileId/invitations" element={<ProtectedRoute session={session}><Layout session={session}><ParticipantProfileInvitations session={session} /></Layout></ProtectedRoute>} />
        <Route
          path="/participants/group/profiles/:profileId"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantProfileCard session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group/:groupId/invitations"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantGroupInvitations session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group/:groupId"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantGroupMembers session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/group/manage"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantGroup key={session?.user?.id} session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/invitations/accept"
          element={<ProtectedRoute session={session}><Layout session={session}><AcceptParticipantInvitation session={session} /></Layout></ProtectedRoute>}
        />
        <Route
          path="/participants/history"
          element={<ProtectedRoute session={session}><Layout session={session}><ParticipantHistory key={session?.user?.id} session={session} /></Layout></ProtectedRoute>}
        />
        <Route path="/participants/groups/invitations/accept" element={<ProtectedRoute session={session}><Layout session={session}><AcceptParticipantGroupInvitation /></Layout></ProtectedRoute>} />
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
        <Route path="*" element={<Navigate to={session ? getAppEntry(session.user.id) : '/login'} />} />
          </Routes>
        </Suspense>
        </LazyRouteErrorBoundary>
      </OrganizationProvider>
    </BrowserRouter>
  )
}

export default App
