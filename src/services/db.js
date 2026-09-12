import { openDB } from 'idb'
import { notifyPendingResultEnqueued } from './syncSignals'
import {
  collectOfflineMediaManifest,
  downloadOfflineMediaAssets,
  estimateOfflineStorage,
} from './offlineMedia'

const DB_NAME = 'QuestPlatformDB'
const DB_VERSION = 11
export const OFFLINE_PACKAGE_VERSION = 2
export const PARTICIPANT_PACKAGE_ACCESS_TTL_MS = 24 * 60 * 60 * 1000

export const UNSYNCED_QUEST_RESULTS_ERROR =
  'UNSYNCED_QUEST_RESULTS'

export function createClientEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function recoverPendingResultOwner(record, localAttempt) {
  if (!localAttempt?.userId) return record

  const recovered = {
    ...record,
    userId: record.userId || localAttempt.userId,
    participantProfileId: record.participantProfileId ||
      localAttempt.participantProfileId ||
      localAttempt.userId,
  }

  return recovered.userId === record.userId &&
    recovered.participantProfileId === record.participantProfileId
    ? record
    : recovered
}

export function hasUnsyncedQuestResults(records, questId) {
  return records.some(record => (
    record.questId === questId && record.synced !== true
  ))
}

export function hasFreshParticipantPackageAccess(
  quest,
  participantProfileId,
  now = Date.now()
) {
  if (!participantProfileId) return true

  const validatedAt = quest?.participantAccess?.[participantProfileId]
  if (!validatedAt) return false

  const validatedAtMs = new Date(validatedAt).getTime()
  return Number.isFinite(validatedAtMs) &&
    now - validatedAtMs <= PARTICIPANT_PACKAGE_ACCESS_TTL_MS
}

export function isActiveAttemptForParticipant(
  attempt,
  questId,
  userId,
  participantProfileId = userId
) {
  return attempt.questId === questId &&
    attempt.userId === userId &&
    !attempt.finished &&
    (attempt.participantProfileId || attempt.userId) === participantProfileId
}

export function shouldAdoptParticipantAttempt(attempt, participantProfileId) {
  return attempt?.participantProfileId === participantProfileId
}

export function sanitizeParticipantTask(task, quest = {}) {
  const verificationOptions = Array.isArray(quest.verification_options)
    ? quest.verification_options
    : []

  const safeTask = {
    ...task,
    requires_answer: task.requires_answer ?? Boolean(task.correct_answer?.trim()),
    requires_code: task.requires_code ?? (
      verificationOptions.includes('code') && Boolean(task.static_code?.trim())
    ),
    requires_gps: task.requires_gps ?? (
      verificationOptions.includes('gps') && Boolean(task.gps_point)
    ),
  }

  delete safeTask.static_code
  delete safeTask.correct_answer
  delete safeTask.gps_point
  delete safeTask.required_photo_hash
  delete safeTask.media_url

  if (quest.verification_mode !== 'hybrid') {
    delete safeTask.answer_verifier
    delete safeTask.code_verifier
  }

  return safeTask
}

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, transaction) {
      const questStore = db.objectStoreNames.contains('quests')
        ? transaction.objectStore('quests')
        : db.createObjectStore('quests', { keyPath: 'id' })
      if (!questStore.indexNames.contains('by_title')) {
        questStore.createIndex('by_title', 'title')
      }

      const pendingStore = db.objectStoreNames.contains('pendingResults')
        ? transaction.objectStore('pendingResults')
        : db.createObjectStore('pendingResults', { keyPath: 'id', autoIncrement: true })
      if (!pendingStore.indexNames.contains('by_quest_id')) {
        pendingStore.createIndex('by_quest_id', 'questId')
      }
      if (!pendingStore.indexNames.contains('by_synced')) {
        pendingStore.createIndex('by_synced', 'synced')
      }
      if (!pendingStore.indexNames.contains('by_local_attempt')) {
        pendingStore.createIndex('by_local_attempt', 'localQuestAttemptId')
      }
      if (!pendingStore.indexNames.contains('by_client_event_id')) {
        pendingStore.createIndex('by_client_event_id', 'clientEventId', { unique: true })
      }
      if (!pendingStore.indexNames.contains('by_user_id')) {
        pendingStore.createIndex('by_user_id', 'userId')
      }

      const dlStore = db.objectStoreNames.contains('downloadedQuests')
        ? transaction.objectStore('downloadedQuests')
        : db.createObjectStore('downloadedQuests', { keyPath: 'questId' })
      if (!dlStore.indexNames.contains('by_downloaded_at')) {
        dlStore.createIndex('by_downloaded_at', 'downloadedAt')
      }
      if (!dlStore.indexNames.contains('by_package_version')) {
        dlStore.createIndex('by_package_version', 'packageVersion')
      }

      const qaStore = db.objectStoreNames.contains('questAttempts')
        ? transaction.objectStore('questAttempts')
        : db.createObjectStore('questAttempts', { keyPath: 'localId' })
      if (!qaStore.indexNames.contains('by_quest_user')) {
        qaStore.createIndex('by_quest_user', ['questId', 'userId'])
      }
      if (!qaStore.indexNames.contains('by_synced')) {
        qaStore.createIndex('by_synced', 'synced')
      }

      if (!db.objectStoreNames.contains('participantProfiles')) {
        db.createObjectStore('participantProfiles', { keyPath: 'userId' })
      }

      const offlineAssetStore = db.objectStoreNames.contains('offlineAssets')
        ? transaction.objectStore('offlineAssets')
        : db.createObjectStore('offlineAssets', { keyPath: 'id' })
      if (!offlineAssetStore.indexNames.contains('by_quest_id')) {
        offlineAssetStore.createIndex('by_quest_id', 'questId')
      }

      if (oldVersion < 8) {
        let cursor = await pendingStore.openCursor()

        while (cursor) {
          const localAttempt = cursor.value.localQuestAttemptId
            ? await qaStore.get(cursor.value.localQuestAttemptId)
            : null
          const recovered = recoverPendingResultOwner(
            cursor.value,
            localAttempt
          )

          if (recovered !== cursor.value) {
            await cursor.update(recovered)
          }

          cursor = await cursor.continue()
        }
      }
    },
  })
}

// ---------- Профили участников ----------
export async function saveParticipantProfiles(userId, profiles) {
  if (!userId) return

  const safeProfiles = (profiles || []).map(profile => ({
    participant_profile_id: profile.participant_profile_id,
    display_name: profile.display_name || 'Участник',
    relationship: profile.relationship || null,
    supervision_status: profile.supervision_status || null,
  })).filter(profile => profile.participant_profile_id)

  const db = await initDB()
  await db.put('participantProfiles', {
    userId,
    profiles: safeProfiles,
    updatedAt: new Date().toISOString(),
  })
}

export async function getParticipantProfiles(userId) {
  if (!userId) return []
  const db = await initDB()
  const record = await db.get('participantProfiles', userId)
  return Array.isArray(record?.profiles) ? record.profiles : []
}

// ---------- Квесты ----------
export async function saveQuestToDB(questData, tasks, participantProfileId = null) {
  const db = await initDB()
  const existingQuest = await db.get('quests', questData.id)
  const participantAccess = { ...(existingQuest?.participantAccess || {}) }
  if (participantProfileId) participantAccess[participantProfileId] = new Date().toISOString()
  const safeTasks = tasks.map(task => sanitizeParticipantTask(task, questData))
  const mediaManifest = collectOfflineMediaManifest(questData, safeTasks)
  const storageEstimate = await estimateOfflineStorage()
  const { assets, assetBytes } = await downloadOfflineMediaAssets(
    mediaManifest,
    { storageEstimate },
  )
  const packageRevision = createClientEventId()
  const offlineAssetRefs = []
  const assetRecords = assets.map((asset, index) => {
    const id = `${questData.id}:${packageRevision}:${index}`
    for (const target of asset.targets) offlineAssetRefs.push({ ...target, assetId: id })
    return {
      id,
      questId: questData.id,
      packageRevision,
      blob: asset.blob,
      sizeBytes: asset.sizeBytes,
      contentType: asset.contentType,
    }
  })
  const questWithTasks = {
    ...questData,
    tasks: safeTasks,
    downloadedAt: new Date().toISOString(),
    participantAccess,
    offlineAssetRefs,
  }
  const serializedPackage = JSON.stringify(questWithTasks)
  const packageSizeBytes = new TextEncoder().encode(serializedPackage).byteLength + assetBytes
  const downloadedAt = new Date().toISOString()
  const existing = await db.get('downloadedQuests', questData.id)
  const packageMetadata = {
    questId: questData.id,
    packageVersion: OFFLINE_PACKAGE_VERSION,
    packageSizeBytes,
    downloadedAt,
    lastSyncDate: existing?.lastSyncDate || null,
  }
  const oldAssets = await db.getAllFromIndex('offlineAssets', 'by_quest_id', questData.id)
  const transaction = db.transaction(
    ['quests', 'downloadedQuests', 'offlineAssets'],
    'readwrite',
  )
  await Promise.all([
    transaction.objectStore('quests').put(questWithTasks),
    transaction.objectStore('downloadedQuests').put(packageMetadata),
    ...assetRecords.map(asset => transaction.objectStore('offlineAssets').put(asset)),
    ...oldAssets.map(asset => transaction.objectStore('offlineAssets').delete(asset.id)),
  ])
  await transaction.done
  return packageMetadata
}

const offlineObjectUrls = new Map()

function applyOfflineAssetUrls(quest, assets) {
  if (!Array.isArray(quest.offlineAssetRefs) || quest.offlineAssetRefs.length === 0) {
    return quest
  }
  const assetsById = new Map(assets.map(asset => [asset.id, asset]))
  const hydrated = {
    ...quest,
    tasks: (quest.tasks || []).map(task => ({
      ...task,
      media: Array.isArray(task.media)
        ? task.media.map(item => ({ ...item }))
        : task.media,
    })),
  }
  for (const url of offlineObjectUrls.get(quest.id) || []) URL.revokeObjectURL(url)
  const createdUrls = []

  for (const reference of quest.offlineAssetRefs) {
    const asset = assetsById.get(reference.assetId)
    if (!asset?.blob) continue
    const localUrl = URL.createObjectURL(asset.blob)
    createdUrls.push(localUrl)
    if (reference.taskId) {
      const task = hydrated.tasks.find(item => item.id === reference.taskId)
      if (task) {
        if (reference.field === 'media' && Number.isInteger(reference.mediaIndex)) {
          const media = task.media?.[reference.mediaIndex]
          if (media) {
            media.url = localUrl
            media.content_type = asset.contentType || null
          }
        } else {
          task[reference.field] = localUrl
          task[`${reference.field}_content_type`] = asset.contentType || null
          if (reference.field === 'offline_map_image_url' && reference.bounds) {
            task.offline_map_bounds = reference.bounds
          }
        }
      }
    } else {
      hydrated[reference.field] = localUrl
      hydrated[`${reference.field}_content_type`] = asset.contentType || null
    }
  }
  offlineObjectUrls.set(quest.id, createdUrls)
  return hydrated
}

export async function getQuestPackageMetadata(questId, participantProfileId = null) {
  const db = await initDB()
  const [download, quest] = await Promise.all([
    db.get('downloadedQuests', questId),
    db.get('quests', questId),
  ])
  if (!download || !quest) return null

  const validatedAt = participantProfileId
    ? quest.participantAccess?.[participantProfileId] || null
    : download.downloadedAt || null
  const validatedAtMs = validatedAt ? new Date(validatedAt).getTime() : NaN

  return {
    ...download,
    packageVersion: download.packageVersion || null,
    packageSizeBytes: download.packageSizeBytes || null,
    validatedAt,
    expiresAt: participantProfileId && Number.isFinite(validatedAtMs)
      ? new Date(validatedAtMs + PARTICIPANT_PACKAGE_ACCESS_TTL_MS).toISOString()
      : null,
  }
}

export async function getQuestFromDB(questId, participantProfileId = null) {
  const db = await initDB()
  const quest = await db.get('quests', questId)
  if (!quest) return quest
  if (!hasFreshParticipantPackageAccess(quest, participantProfileId)) return null

  const safeTasks = (quest.tasks || []).map(task =>
    sanitizeParticipantTask(task, quest)
  )
  const sanitizedQuest = { ...quest, tasks: safeTasks }

  // Очищает от секретов также квесты, сохранённые старой версией приложения.
  await db.put('quests', sanitizedQuest)
  const assets = await db.getAllFromIndex('offlineAssets', 'by_quest_id', questId)
  return applyOfflineAssetUrls(sanitizedQuest, assets)
}

export async function getDownloadedQuests() {
  const db = await initDB()
  return db.getAll('downloadedQuests')
}

export async function getDownloadedQuestPackages(now = Date.now()) {
  const db = await initDB()
  const downloads = await db.getAll('downloadedQuests')
  const packages = []

  for (const download of downloads) {
    const quest = await db.get('quests', download.questId)
    if (!quest) continue

    const participantEntries = Object.entries(quest.participantAccess || {})
    if (participantEntries.length === 0) {
      packages.push({
        ...download,
        title: quest.title || 'Без названия',
        participantProfileId: null,
        validatedAt: null,
        expiresAt: null,
        isFresh: false,
        legacy: true,
      })
      continue
    }

    for (const [participantProfileId, validatedAt] of participantEntries) {
      const validatedAtMs = new Date(validatedAt).getTime()
      packages.push({
        ...download,
        title: quest.title || 'Без названия',
        participantProfileId,
        validatedAt,
        expiresAt: Number.isFinite(validatedAtMs)
          ? new Date(validatedAtMs + PARTICIPANT_PACKAGE_ACCESS_TTL_MS).toISOString()
          : null,
        isFresh: hasFreshParticipantPackageAccess(
          quest,
          participantProfileId,
          now
        ),
        legacy: false,
      })
    }
  }

  return packages
}

export function buildOfflineAccessibleQuestRecord(quest, profiles, now = Date.now()) {
  if (!quest || quest.is_public !== false || quest.is_open !== true) return null

  const startAt = quest.start_at ? new Date(quest.start_at).getTime() : null
  const endAt = quest.end_at ? new Date(quest.end_at).getTime() : null
  if (Number.isFinite(startAt) && startAt > now) return null
  if (Number.isFinite(endAt) && endAt < now) return null

  const profilesById = new Map((profiles || []).map(profile => [
    profile.participant_profile_id,
    profile,
  ]))
  const participants = Object.keys(quest.participantAccess || {})
    .filter(participantProfileId => (
      profilesById.has(participantProfileId) &&
      hasFreshParticipantPackageAccess(quest, participantProfileId, now)
    ))
    .map(participantProfileId => profilesById.get(participantProfileId))

  if (participants.length === 0) return null

  return {
    quest_id: quest.id,
    title: quest.title || 'Без названия',
    description: quest.description || null,
    start_at: quest.start_at || null,
    end_at: quest.end_at || null,
    participants,
    offline_package: true,
  }
}

export async function getOfflineAccessiblePrivateQuests(
  userId,
  now = Date.now()
) {
  if (!userId) return []

  const db = await initDB()
  const [downloads, profiles] = await Promise.all([
    db.getAll('downloadedQuests'),
    getParticipantProfiles(userId),
  ])
  const result = []

  for (const download of downloads) {
    const quest = await db.get('quests', download.questId)
    const record = buildOfflineAccessibleQuestRecord(quest, profiles, now)
    if (record) result.push(record)
  }

  return result.sort((left, right) => left.title.localeCompare(
    right.title,
    'ru',
    { sensitivity: 'base' },
  ))
}

export async function updateQuestSyncDate(questId, syncDate) {
  const db = await initDB()
  const record = await db.get('downloadedQuests', questId)
  if (record) {
    record.lastSyncDate = syncDate
    await db.put('downloadedQuests', record)
  }
}

export async function removeQuestFromDB(questId) {
  const db = await initDB()
  const pending = await db.getAllFromIndex(
    'pendingResults',
    'by_quest_id',
    questId
  )

  if (hasUnsyncedQuestResults(pending, questId)) {
    const error = new Error(
      'Сначала синхронизируйте результаты этого квеста'
    )
    error.code = UNSYNCED_QUEST_RESULTS_ERROR
    throw error
  }

  await db.delete('quests', questId)
  await db.delete('downloadedQuests', questId)
  const assets = await db.getAllFromIndex('offlineAssets', 'by_quest_id', questId)
  const transaction = db.transaction('offlineAssets', 'readwrite')
  await Promise.all(assets.map(asset => transaction.store.delete(asset.id)))
  await transaction.done
}

// ---------- Локальные результаты заданий (pendingResults) ----------
export async function upsertPendingResult(questId, taskId, localQuestAttemptId, data) {
  const db = await initDB()
  const localAttempt = await db.get(
    'questAttempts',
    localQuestAttemptId
  )

  if (!localAttempt?.userId) {
    throw new Error(
      'Не удалось определить владельца локальной попытки'
    )
  }

  const tx = db.transaction('pendingResults', 'readwrite')
  const store = tx.objectStore('pendingResults')
  const all = await store.getAll()
  const existing = all.find(
    (r) =>
      r.questId === questId &&
      r.taskId === taskId &&
      r.localQuestAttemptId === localQuestAttemptId
  )
  const record = {
    questId,
    taskId,
    localQuestAttemptId,
    clientEventId: existing?.clientEventId || createClientEventId(),
    userId: localAttempt.userId,
    participantProfileId: localAttempt.participantProfileId || localAttempt.userId,
    ...data,
    synced: false,
    updatedAt: new Date().toISOString(),
  }
  if (existing) {
    await store.put({ ...existing, ...record, id: existing.id })
  } else {
    await store.add(record)
  }
  await tx.done
}

export async function enqueuePendingEvent(
  questId,
  taskId,
  localQuestAttemptId,
  data
) {
  const db = await initDB()
  const localAttempt = await db.get(
    'questAttempts',
    localQuestAttemptId
  )

  if (!localAttempt?.userId) {
    throw new Error(
      'Не удалось определить владельца локальной попытки'
    )
  }

  const now = new Date().toISOString()
  const record = {
    ...data,
    questId,
    taskId,
    localQuestAttemptId,
    clientEventId: data.clientEventId || createClientEventId(),
    userId: localAttempt.userId,
    participantProfileId: localAttempt.participantProfileId || localAttempt.userId,
    synced: false,
    createdAt: now,
    updatedAt: now,
  }

  await db.add('pendingResults', record)
  notifyPendingResultEnqueued()
  return record
}

export async function getPendingResults(userId = null) {
  const db = await initDB()
  const tx = db.transaction(
    ['pendingResults', 'questAttempts'],
    'readwrite'
  )
  const store = tx.objectStore('pendingResults')
  const attemptStore = tx.objectStore('questAttempts')
  const records = await store.getAll()

  for (const record of records) {
    let changed = false

    if (!record.clientEventId) {
      record.clientEventId = createClientEventId()
      changed = true
    }

    if (
      (!record.userId || !record.participantProfileId) &&
      record.localQuestAttemptId
    ) {
      const localAttempt = await attemptStore.get(
        record.localQuestAttemptId
      )
      const recovered = recoverPendingResultOwner(record, localAttempt)

      if (recovered !== record) {
        Object.assign(record, recovered)
        changed = true
      }
    }

    if (changed) {
      await store.put(record)
    }
  }

  await tx.done
  return userId
    ? records.filter(record => record.userId === userId)
    : records
}

export async function markResultsSynced(ids) {
  const db = await initDB()
  const tx = db.transaction('pendingResults', 'readwrite')
  const store = tx.objectStore('pendingResults')
  for (const id of ids) {
    const record = await store.get(id)
    if (record) {
      record.synced = true
      await store.put(record)
    }
  }
  await tx.done
}

// ... остальные функции без изменений ...

export async function clearSyncedResults(userId = null) {
  const db = await initDB()
  const tx = db.transaction('pendingResults', 'readwrite')
  const store = tx.objectStore('pendingResults')

  // Boolean допустим как значение поля, но не как ключ IndexedDB.
  // Удаляем только явно подтверждённые события.
  let cursor = await store.openCursor()

  while (cursor) {
    if (
      cursor.value.synced === true &&
      (!userId || cursor.value.userId === userId)
    ) {
      await cursor.delete()
    }

    cursor = await cursor.continue()
  }

  await tx.done
}

// ---------- Локальные попытки прохождения (questAttempts) ----------
export async function saveQuestAttempt(localId, questId, userId, serverId = null, synced = false, finished = false, participantProfileId = userId) {
  const db = await initDB()
  await db.put('questAttempts', {
    localId,
    questId,
    userId,
    participantProfileId,
    serverId,
    synced,
    finished,
    updatedAt: new Date().toISOString(),
  })
}

export async function getQuestAttempt(localId) {
  const db = await initDB()
  return db.get('questAttempts', localId)
}

export async function getActiveLocalQuestAttempt(questId, userId, participantProfileId = userId) {
  const db = await initDB()
  const tx = db.transaction('questAttempts', 'readonly')
  const store = tx.objectStore('questAttempts')
  const index = store.index('by_quest_user')
  let cursor = await index.openCursor([questId, userId])
  while (cursor) {
    if (isActiveAttemptForParticipant(
      cursor.value,
      questId,
      userId,
      participantProfileId
    )) {
      return cursor.value
    }
    cursor = await cursor.continue()
  }
  return null
}

export async function markQuestAttemptSynced(localId, serverId) {
  const db = await initDB()
  const record = await db.get('questAttempts', localId)
  if (record) {
    record.serverId = serverId
    record.synced = true
    await db.put('questAttempts', record)
  }
}

export async function finishQuestAttempt(localId) {
  const db = await initDB()
  const record = await db.get('questAttempts', localId)

  if (record) {
    record.finished = true
    record.updatedAt = new Date().toISOString()
    await db.put('questAttempts', record)
  }
}

export function isQuestAttemptAlias(record, localId, serverId) {
  return record.localId === localId || Boolean(
    serverId && (
      record.serverId === serverId ||
      record.localId === serverId
    )
  )
}

export async function finishQuestAttemptAliases(localId, serverId = null) {
  const db = await initDB()
  const tx = db.transaction('questAttempts', 'readwrite')
  const store = tx.objectStore('questAttempts')
  const target = await store.get(localId)
  const resolvedServerId = serverId || target?.serverId || null
  let cursor = await store.openCursor()

  while (cursor) {
    const record = cursor.value

    if (isQuestAttemptAlias(record, localId, resolvedServerId)) {
      await cursor.update({
        ...record,
        finished: true,
        updatedAt: new Date().toISOString(),
      })
    }

    cursor = await cursor.continue()
  }

  await tx.done
}

export async function clearAllLocalData() {
  const db = await initDB()
  const stores = ['quests', 'pendingResults', 'downloadedQuests', 'questAttempts', 'participantProfiles', 'offlineAssets']
  const tx = db.transaction(stores, 'readwrite')
  for (const store of stores) {
    await tx.objectStore(store).clear()
  }
  await tx.done
  console.log('Все локальные данные очищены')
}

export async function clearFinishedQuestAttempts() {
  const db = await initDB()
  const tx = db.transaction('questAttempts', 'readwrite')
  const store = tx.objectStore('questAttempts')
  const all = await store.getAll()
  for (const record of all) {
    if (record.finished === true && record.synced === true) {
      await store.delete(record.localId)
    }
  }
  await tx.done
}

export async function adoptParticipantOfflineData(
  participantProfileId,
  newUserId
) {
  const db = await initDB()
  const tx = db.transaction(
    ['questAttempts', 'pendingResults'],
    'readwrite'
  )
  const attemptStore = tx.objectStore('questAttempts')
  const pendingStore = tx.objectStore('pendingResults')
  const adoptedAttemptIds = new Set()
  let adoptedAttempts = 0
  let adoptedEvents = 0
  let attemptCursor = await attemptStore.openCursor()

  while (attemptCursor) {
    const attempt = attemptCursor.value
    if (shouldAdoptParticipantAttempt(attempt, participantProfileId)) {
      adoptedAttemptIds.add(attempt.localId)
      if (attempt.userId !== newUserId) {
        await attemptCursor.update({
          ...attempt,
          userId: newUserId,
          updatedAt: new Date().toISOString(),
        })
        adoptedAttempts += 1
      }
    }
    attemptCursor = await attemptCursor.continue()
  }

  let pendingCursor = await pendingStore.openCursor()
  while (pendingCursor) {
    const event = pendingCursor.value
    if (
      adoptedAttemptIds.has(event.localQuestAttemptId) &&
      event.userId !== newUserId
    ) {
      await pendingCursor.update({
        ...event,
        userId: newUserId,
        updatedAt: new Date().toISOString(),
      })
      adoptedEvents += 1
    }
    pendingCursor = await pendingCursor.continue()
  }

  await tx.done
  return { adoptedAttempts, adoptedEvents }
}
