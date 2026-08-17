import { openDB } from 'idb'

const DB_NAME = 'QuestPlatformDB'
const DB_VERSION = 6

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < DB_VERSION) {
        if (db.objectStoreNames.contains('quests')) {
          db.deleteObjectStore('quests')
        }
        if (db.objectStoreNames.contains('pendingResults')) {
          db.deleteObjectStore('pendingResults')
        }
        if (db.objectStoreNames.contains('downloadedQuests')) {
          db.deleteObjectStore('downloadedQuests')
        }
        if (db.objectStoreNames.contains('questAttempts')) {
          db.deleteObjectStore('questAttempts')
        }
      }

      const questStore = db.createObjectStore('quests', { keyPath: 'id' })
      questStore.createIndex('by_title', 'title')

      const pendingStore = db.createObjectStore('pendingResults', { keyPath: 'id', autoIncrement: true })
      pendingStore.createIndex('by_quest_id', 'questId')
      pendingStore.createIndex('by_synced', 'synced')
      pendingStore.createIndex('by_local_attempt', 'localQuestAttemptId')

      const dlStore = db.createObjectStore('downloadedQuests', { keyPath: 'questId' })
      dlStore.createIndex('by_downloaded_at', 'downloadedAt')

      const qaStore = db.createObjectStore('questAttempts', { keyPath: 'localId' })
      qaStore.createIndex('by_quest_user', ['questId', 'userId'])
      qaStore.createIndex('by_synced', 'synced')
    },
  })
}

// ---------- Квесты ----------
export async function saveQuestToDB(questData, tasks) {
  const db = await initDB()
  const questWithTasks = { ...questData, tasks, downloadedAt: new Date().toISOString() }
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
  return db.get('quests', questId)
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
  await db.delete('quests', questId)
  await db.delete('downloadedQuests', questId)
  const tx = db.transaction('pendingResults', 'readwrite')
  const store = tx.objectStore('pendingResults')
  const index = store.index('by_quest_id')
  let cursor = await index.openCursor(questId)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// ---------- Локальные результаты заданий (pendingResults) ----------
export async function upsertPendingResult(questId, taskId, localQuestAttemptId, data) {
  const db = await initDB()
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

export async function getPendingResults() {
  const db = await initDB()
  const tx = db.transaction('pendingResults', 'readonly')
  const store = tx.objectStore('pendingResults')
  return store.getAll()
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

export async function clearSyncedResults() {
  const db = await initDB()
  const tx = db.transaction('pendingResults', 'readwrite')
  const store = tx.objectStore('pendingResults')
  const index = store.index('by_synced')
  // Используем прямой курсор с ключом true (без IDBKeyRange)
  let cursor = await index.openCursor(true)
  while (cursor) {
    await cursor.delete()
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
    await db.put('questAttempts', record)
  }
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
    if (record.finished) {
      await store.delete(record.localId)
    }
  }
  await tx.done
}