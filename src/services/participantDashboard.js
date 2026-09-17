import { getDownloadedQuestPackages, getLocalParticipantAttempts, getParticipantProfiles, getPendingResults, saveParticipantProfiles, saveQuestToDB, OFFLINE_PACKAGE_VERSION } from './db'
import { listMyParticipantProfiles } from './participantGroupApi'
import { loadParticipantQuest, loadParticipantTasks } from './questApi'
import { isTransportError } from './network'

export const PARTICIPANT_DASHBOARD_CHANGED = 'participant-dashboard-changed'

export async function loadParticipantDashboard(userId, signal) {
  if (!userId) throw new Error('Требуется вход в аккаунт.')
  let profiles, quests = [], offline = !navigator.onLine
  if (!offline) {
    try {
      profiles = await listMyParticipantProfiles()
      signal?.throwIfAborted()
      profiles = profiles.filter(p => p.participant_profile_id && (p.relationship === 'self' || p.relationship === 'group_manager' || p.supervision_status === 'active'))
      await saveParticipantProfiles(userId, profiles)
    } catch (error) {
      signal?.throwIfAborted()
      if (!isTransportError(error)) throw error
      offline = true
    }
  }
  if (offline) profiles = await getParticipantProfiles(userId)
  const [packages, attempts, pending] = await Promise.all([
    getDownloadedQuestPackages(Date.now(), userId), getLocalParticipantAttempts(userId), getPendingResults(userId),
  ])
  signal?.throwIfAborted()
  const ids = new Set(profiles.map(p => p.participant_profile_id))
  return {
    profiles, quests, offline,
    packages: packages.filter(p => ids.has(p.participantProfileId)),
    attempts: attempts.filter(a => ids.has(a.participantProfileId || a.userId)),
    // Даже отозванный профиль не должен скрывать ожидающие события аккаунта.
    pending: pending.filter(p => !p.synced),
  }
}

export function packageReadiness(pkg, now = Date.now()) {
  if (!pkg) return { key: 'missing', text: 'Не скачан', ready: false }
  if (pkg.legacy || pkg.packageVersion !== OFFLINE_PACKAGE_VERSION || !pkg.isFresh || !Number.isFinite(Date.parse(pkg.expiresAt)) || Date.parse(pkg.expiresAt) <= now) {
    return { key: 'expired', text: 'Нужно обновить доступ онлайн', ready: false }
  }
  if (pkg.is_open === false || Date.parse(pkg.end_at) < now || Date.parse(pkg.start_at) > now) return { key: 'unavailable', text: 'Прохождение сейчас недоступно', ready: false }
  if (pkg.offlineStartRequiresPermit && !pkg.offlineStartPrepared) return { key: 'needs-permit', text: 'Подготовьте старт онлайн', ready: false }
  if (pkg.offlineMediaFailures?.length) return { key: 'partial', text: 'Пакет неполный', ready: false }
  return { key: 'ready', text: 'Готов офлайн', ready: true }
}

export function buildParticipantQuestRows(data, profileId, now = Date.now()) {
  if (!profileId || !data.profiles.some(p => p.participant_profile_id === profileId)) return []
  const rows = new Map()
  for (const quest of data.quests) {
    if (quest.participants?.some(p => p.participant_profile_id === profileId)) {
      rows.set(quest.quest_id, { ...quest, id: quest.quest_id, remote: true })
    }
  }
  for (const pkg of data.packages) {
    if (pkg.participantProfileId !== profileId) continue
    const row = rows.get(pkg.questId) || { id: pkg.questId, title: pkg.title, remote: false }
    rows.set(pkg.questId, { ...row, package: pkg })
  }
  const attempts = new Map()
  for (const attempt of data.attempts) {
    if ((attempt.participantProfileId || attempt.userId) !== profileId || attempt.finished || Date.parse(attempt.deadlineAt) <= now || data.pending.some(p => p.localQuestAttemptId === attempt.localId && p.eventType === 'finish')) continue
    const old = attempts.get(attempt.questId)
    if (!old || String(attempt.updatedAt || '') > String(old.updatedAt || '')) attempts.set(attempt.questId, attempt)
  }
  return [...rows.values()].map(row => ({
    ...row, profileId, readiness: packageReadiness(row.package ? { ...row.package, offlineStartPrepared: row.package.offlineStartPrepared || Boolean(row.active_attempt_id || attempts.get(row.id)) } : null, now),
    attempt: data.pending.some(p => p.questId === row.id && p.participantProfileId === profileId && p.eventType === 'finish') ? null
      : row.active_attempt_id ? { serverId: row.active_attempt_id, updatedAt: row.attempt_started_at, remote: true } : attempts.get(row.id) || null,
    pendingCount: data.pending.filter(p => p.questId === row.id && p.participantProfileId === profileId).length,
  })).sort((a, b) => a.title.localeCompare(b.title, 'ru') || String(a.id).localeCompare(String(b.id)))
}

export async function downloadParticipantQuest(questId, profileId, signal) {
  if (!navigator.onLine) throw new Error('Для скачивания подключитесь к интернету.')
  const quest = await loadParticipantQuest(questId, profileId, signal)
  const tasks = await loadParticipantTasks(questId, profileId, signal)
  signal?.throwIfAborted()
  if (!quest?.id || quest.id !== questId) throw new Error('Не удалось проверить доступ к квесту.')
  const metadata = await saveQuestToDB(quest, tasks, profileId, signal)
  window.dispatchEvent(new Event(PARTICIPANT_DASHBOARD_CHANGED))
  return metadata
}
