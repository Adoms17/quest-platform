import { openDB } from 'idb'
import { notifyPendingResultEnqueued } from './syncSignals'

const DB_NAME = 'QuestPlatformDB'
const DB_VERSION = 8

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
  if (record.userId || !localAttempt?.userId) return record

  return {
    ...record,
    userId: localAttempt.userId,
  }
}

export function hasUnsyncedQuestResults(records, questId) {
  return records.some(record => (
    record.questId === questId && record.synced !== true
  ))
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

      const qaStore = db.objectStoreNames.contains('questAttempts')
        ? transaction.objectStore('questAttempts')
        : db.createObjectStore('questAttempts', { keyPath: 'localId' })
      if (!qaStore.indexNames.contains('by_quest_user')) {
        qaStore.createIndex('by_quest_user', ['questId', 'userId'])
      }
      if (!qaStore.indexNames.contains('by_synced')) {
        qaStore.createIndex('by_synced', 'synced')
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

// ---------- Квесты ----------
export async function saveQuestToDB(questData, tasks) {
  const db = await initDB()
  const safeTasks = tasks.map(task => sanitizeParticipantTask(task, questData))
  const questWithTasks = {
    ...questData,
    tasks: safeTasks,
    downloadedAt: new Date().toISOString(),
  }
  await db.put('quests', questWithTasks)
  const existing = await db.get('downloadedQuests', questData.id)
  await db.put('downloadedQuests', {
    questId: questData.id,
    downloadedAt: new Date().toISOString(),
    lastSyncDate: existing?.lastSyncDate || null,
  })
}

export async function getQuestFromDB(questId) {
  const db = await initDB()
  const quest = await db.get('quests', questId)
  if (!quest) return quest

  const safeTasks = (quest.tasks || []).map(task =>
    sanitizeParticipantTask(task, quest)
  )
  const sanitizedQuest = { ...quest, tasks: safeTasks }

  // Очищает от секретов также квесты, сохранённые старой версией приложения.
  await db.put('quests', sanitizedQuest)
  return sanitizedQuest
}

export async function getDownloadedQuests() {
  const db = await initDB()
  return db.getAll('downloadedQuests')
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

    if (!record.userId && record.localQuestAttemptId) {
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
export async function saveQuestAttempt(localId, questId, userId, serverId = null, synced = false, finished = false) {
  const db = await initDB()
  await db.put('questAttempts', {
    localId,
    questId,
    userId,
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

export async function getActiveLocalQuestAttempt(questId, userId) {
  const db = await initDB()
  const tx = db.transaction('questAttempts', 'readonly')
  const store = tx.objectStore('questAttempts')
  const index = store.index('by_quest_user')
  let cursor = await index.openCursor([questId, userId])
  while (cursor) {
    if (!cursor.value.finished) {
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
  const stores = ['quests', 'pendingResults', 'downloadedQuests', 'questAttempts']
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
