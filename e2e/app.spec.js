import { expect, test } from '@playwright/test'

function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error))
  return errors
}

async function expectLoginPage(page) {
  await expect(page.getByRole('heading', { name: 'Quest Platform' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
}

test('opens the login page directly', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/login')

  await expectLoginPage(page)
  await expect(page).toHaveURL(/\/login$/)
  expect(pageErrors).toEqual([])
})

test('redirects a protected route to login without a session', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/quests')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})

test('redirects an unknown route and renders the application', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/unknown-e2e-route')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Quest Platform' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('protects a quest access management route', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/quests/00000000-0000-4000-8000-000000000001/access')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})

test('protects an access token without leaking it into the login URL', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/access/redeem?token=browser-smoke-secret')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  await expect(page).not.toHaveURL(/browser-smoke-secret/)
  expect(pageErrors).toEqual([])
})

test('protects the short-code redemption page', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/access/code')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})

test('keeps offline quest packages isolated by participant after reload', async ({ page }) => {
  await page.goto('/login')

  await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    await db.clearAllLocalData()
    await db.saveQuestToDB({
      id: 'offline-quest',
      title: 'Offline quest',
      verification_options: [],
    }, [{ id: 'task-1', title: 'Task' }], 'profile-a')
  })

  await page.reload()

  const result = await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    return {
      own: await db.getQuestFromDB('offline-quest', 'profile-a'),
      other: await db.getQuestFromDB('offline-quest', 'profile-b'),
      packages: await db.getDownloadedQuestPackages(),
    }
  })

  expect(result.own?.title).toBe('Offline quest')
  expect(result.other).toBeNull()
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]).toMatchObject({
    participantProfileId: 'profile-a',
    isFresh: true,
    legacy: false,
  })
})

test('restores a participant attempt and unsynced event after reload', async ({ page }) => {
  await page.goto('/login')

  await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    await db.clearAllLocalData()
    await db.saveQuestAttempt(
      'local-attempt',
      'offline-quest',
      'adult-1',
      null,
      false,
      false,
      'child-1'
    )
    await db.enqueuePendingEvent(
      'offline-quest',
      'task-1',
      'local-attempt',
      { eventType: 'open' }
    )
  })

  await page.reload()

  const result = await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    const attempt = await db.getActiveLocalQuestAttempt(
      'offline-quest',
      'adult-1',
      'child-1'
    )
    const pending = await db.getPendingResults('adult-1')
    return { attempt, pending }
  })

  expect(result.attempt?.localId).toBe('local-attempt')
  expect(result.attempt?.participantProfileId).toBe('child-1')
  expect(result.pending).toHaveLength(1)
  expect(result.pending[0]).toMatchObject({
    localQuestAttemptId: 'local-attempt',
    participantProfileId: 'child-1',
    eventType: 'open',
    synced: false,
  })
})

test('upgrades IndexedDB without losing offline or pending data', async ({ page }) => {
  await page.goto('/login')

  const result = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('QuestPlatformDB')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB deletion was blocked'))
    })

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('QuestPlatformDB', 8)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('quests', { keyPath: 'id' })
        const pending = database.createObjectStore('pendingResults', {
          keyPath: 'id',
          autoIncrement: true,
        })
        pending.createIndex('by_quest_id', 'questId')
        pending.createIndex('by_synced', 'synced')
        pending.createIndex('by_local_attempt', 'localQuestAttemptId')
        pending.createIndex('by_client_event_id', 'clientEventId', { unique: true })
        pending.createIndex('by_user_id', 'userId')
        const downloads = database.createObjectStore('downloadedQuests', { keyPath: 'questId' })
        downloads.createIndex('by_downloaded_at', 'downloadedAt')
        const attempts = database.createObjectStore('questAttempts', { keyPath: 'localId' })
        attempts.createIndex('by_quest_user', ['questId', 'userId'])
        attempts.createIndex('by_synced', 'synced')
      }
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(
          ['quests', 'pendingResults', 'downloadedQuests', 'questAttempts'],
          'readwrite'
        )
        transaction.objectStore('quests').put({ id: 'quest-before-upgrade', title: 'Saved quest' })
        transaction.objectStore('downloadedQuests').put({
          questId: 'quest-before-upgrade',
          downloadedAt: '2026-09-09T06:00:00.000Z',
        })
        transaction.objectStore('questAttempts').put({
          localId: 'attempt-before-upgrade',
          questId: 'quest-before-upgrade',
          userId: 'adult-1',
          participantProfileId: 'child-1',
          finished: false,
          synced: false,
        })
        transaction.objectStore('pendingResults').put({
          clientEventId: 'event-before-upgrade',
          questId: 'quest-before-upgrade',
          localQuestAttemptId: 'attempt-before-upgrade',
          userId: 'adult-1',
          participantProfileId: 'child-1',
          synced: false,
        })
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })

    const dbModule = await import('/src/services/db.js?indexeddb-upgrade=10')
    const database = await dbModule.initDB()
    const [quest, attempt, pending] = await Promise.all([
      database.get('quests', 'quest-before-upgrade'),
      database.get('questAttempts', 'attempt-before-upgrade'),
      database.getFromIndex('pendingResults', 'by_client_event_id', 'event-before-upgrade'),
    ])

    const upgradedState = {
      version: database.version,
      hasPackageVersionIndex: database
        .transaction('downloadedQuests')
        .objectStore('downloadedQuests')
        .indexNames
        .contains('by_package_version'),
      hasParticipantProfilesStore: database.objectStoreNames.contains('participantProfiles'),
      quest,
      attempt,
      pending,
    }
    database.close()
    return upgradedState
  })

  expect(result.version).toBe(10)
  expect(result.hasPackageVersionIndex).toBe(true)
  expect(result.hasParticipantProfilesStore).toBe(true)
  expect(result.quest?.title).toBe('Saved quest')
  expect(result.attempt).toMatchObject({
    localId: 'attempt-before-upgrade',
    participantProfileId: 'child-1',
    synced: false,
  })
  expect(result.pending).toMatchObject({
    clientEventId: 'event-before-upgrade',
    participantProfileId: 'child-1',
    synced: false,
  })
})

test('restores and synchronizes a complete authorized offline attempt without duplicates', async ({ page }, testInfo) => {
  test.skip(!process.env.RUN_LOCAL_SUPABASE_E2E, 'requires a running local Supabase stack')
  testInfo.setTimeout(180_000)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const email = `e2e-offline-${suffix}@example.test`
  const password = 'Local-offline-e2e-password-42'

  await page.goto('/login')
  const setup = await page.evaluate(async ({ email: userEmail, password: userPassword }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const db = await import('/src/services/db.js')
    const requireData = (result, operation) => {
      if (result.error) throw new Error(`${operation}: ${result.error.message}`)
      return result.data
    }
    const waitFor = async (load, predicate, operation) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const data = requireData(await load(), operation)
        if (predicate(data)) return data
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`${operation}: timed out`)
    }

    await db.clearAllLocalData()
    const auth = requireData(await supabase.auth.signUp({
      email: userEmail,
      password: userPassword,
      options: { data: { username: `E2E offline ${userEmail}` } },
    }), 'sign up')
    if (!auth.user || !auth.session) throw new Error('offline user session was not created')

    const memberships = await waitFor(
      () => supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('status', 'active'),
      rows => Boolean(rows?.[0]?.organization_id),
      'load organization'
    )
    const organizationId = memberships?.[0]?.organization_id
    if (!organizationId) throw new Error('personal organization was not provisioned')

    const quest = requireData(await supabase.from('quests').insert({
      creator_id: auth.user.id,
      organization_id: organizationId,
      title: 'Authorized offline E2E',
      is_public: true,
      is_open: true,
      max_attempts: 1,
      verification_options: [],
      location_options: [],
    }).select('id').single(), 'create quest')
    const task = requireData(await supabase.from('tasks').insert({
      quest_id: quest.id,
      title: 'Offline answer',
      order_index: 0,
    }).select('id').single(), 'create task')
    const profiles = await waitFor(
      () => supabase.rpc('get_my_participant_profiles'),
      rows => rows.some(profile => profile.relationship === 'self'),
      'load participant profile'
    )
    const participantProfileId = profiles.find(profile => (
      profile.relationship === 'self'
    ))?.participant_profile_id
    if (!participantProfileId) throw new Error('self participant profile was not provisioned')

    const localAttemptId = `offline-attempt-${crypto.randomUUID()}`
    await db.saveQuestToDB({
      id: quest.id,
      title: 'Authorized offline E2E',
      is_public: true,
      is_open: true,
      max_attempts: 1,
      verification_options: [],
    }, [{ id: task.id, title: 'Offline answer', requires_answer: false }], participantProfileId)
    await db.saveQuestAttempt(
      localAttemptId,
      quest.id,
      auth.user.id,
      null,
      false,
      false,
      participantProfileId
    )
    return {
      userId: auth.user.id,
      questId: quest.id,
      participantProfileId,
      localAttemptId,
      taskId: task.id,
      clientEventIds: [crypto.randomUUID(), crypto.randomUUID()],
    }
  }, { email, password })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Квесты', exact: true })).toBeVisible()
  await page.evaluate(() => import('/src/services/db.js').then(() => true))
  await page.context().setOffline(true)

  const recovered = await page.evaluate(async ({ setup: values }) => {
    const db = await import('/src/services/db.js')
    await db.enqueuePendingEvent(values.questId, values.taskId, values.localAttemptId, {
      clientEventId: values.clientEventIds[0],
      eventType: 'open',
      clientElapsedSeconds: 1,
    })
    await db.enqueuePendingEvent(values.questId, values.taskId, values.localAttemptId, {
      clientEventId: values.clientEventIds[1],
      eventType: 'answer',
      clientElapsedSeconds: 2,
    })
    const attempt = await db.getActiveLocalQuestAttempt(
      values.questId,
      values.userId,
      values.participantProfileId
    )
    const pending = await db.getPendingResults()
    return {
      online: navigator.onLine,
      attempt,
      pending: pending.filter(record => record.localQuestAttemptId === values.localAttemptId),
    }
  }, { setup })

  expect(recovered.online).toBe(false)
  expect(recovered.attempt?.localId).toBe(setup.localAttemptId)
  expect(recovered.pending).toHaveLength(2)
  expect(recovered.pending.map(record => record.eventType)).toEqual(['open', 'answer'])

  await page.context().setOffline(false)

  await expect.poll(async () => page.evaluate(async ({ setup: values }) => {
    const db = await import('/src/services/db.js')
    const pending = await db.getPendingResults(values.userId)
    return pending.filter(record => (
      record.localQuestAttemptId === values.localAttemptId && !record.synced
    )).length
  }, { setup }), { timeout: 30_000 }).toBe(0)

  const synchronized = await page.evaluate(async ({ setup: values }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const { syncPendingResults } = await import('/src/services/sync.js')
    const db = await import('/src/services/db.js')
    const retry = await syncPendingResults(null, { suppressErrorToast: true })
    const receipts = await supabase.rpc('get_task_event_receipts', {
      p_client_event_ids: values.clientEventIds,
    })
    if (receipts.error) throw new Error(receipts.error.message)
    return {
      retry,
      receipts: receipts.data,
      pending: await db.getPendingResults(),
    }
  }, { setup })

  expect(synchronized.retry).toMatchObject({ syncedEvents: 0 })
  expect(synchronized.receipts).toHaveLength(2)
  expect(new Set(synchronized.receipts.map(receipt => receipt.client_event_id))).toEqual(
    new Set(setup.clientEventIds)
  )
  expect(synchronized.pending).toEqual([])

  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js')
    supabase.auth.stopAutoRefresh()
    await supabase.removeAllChannels()
  })
  await page.goto('about:blank')
  await page.context().close()
})

test('completes an authorized quest through the participant UI', async ({ page }, testInfo) => {
  test.skip(!process.env.RUN_LOCAL_SUPABASE_E2E, 'requires a running local Supabase stack')
  testInfo.setTimeout(120_000)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const email = `e2e-ui-${suffix}@example.test`
  const password = 'Local-ui-e2e-password-42'

  await page.goto('/login')
  const setup = await page.evaluate(async ({ email: userEmail, password: userPassword }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const requireData = (result, operation) => {
      if (result.error) throw new Error(`${operation}: ${result.error.message}`)
      return result.data
    }
    const waitFor = async (load, predicate, operation) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const data = requireData(await load(), operation)
        if (predicate(data)) return data
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`${operation}: timed out`)
    }

    const auth = requireData(await supabase.auth.signUp({
      email: userEmail,
      password: userPassword,
      options: { data: { username: `UI E2E participant ${userEmail}` } },
    }), 'sign up')
    if (!auth.user || !auth.session) throw new Error('UI E2E user session was not created')

    const memberships = await waitFor(
      () => supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('status', 'active'),
      rows => Boolean(rows?.[0]?.organization_id),
      'load organization'
    )
    const organizationId = memberships?.[0]?.organization_id
    if (!organizationId) throw new Error('personal organization was not provisioned')

    const quest = requireData(await supabase.from('quests').insert({
      creator_id: auth.user.id,
      organization_id: organizationId,
      title: 'UI participant journey E2E',
      is_public: true,
      is_open: true,
      max_attempts: 1,
      verification_options: [],
      location_options: [],
      task_navigation_mode: 'sequential',
    }).select('id').single(), 'create quest')
    requireData(await supabase.from('tasks').insert({
      quest_id: quest.id,
      title: 'UI E2E task',
      order_index: 0,
    }), 'create task')
    const profiles = await waitFor(
      () => supabase.rpc('get_my_participant_profiles'),
      rows => rows.some(profile => profile.relationship === 'self'),
      'load participant profile'
    )
    const participantProfileId = profiles.find(profile => (
      profile.relationship === 'self'
    ))?.participant_profile_id
    if (!participantProfileId) throw new Error('self participant profile was not provisioned')

    requireData(await supabase.auth.signOut(), 'sign out after setup')
    return { questId: quest.id, participantProfileId }
  }, { email, password })

  await page.reload()
  await expectLoginPage(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/quests$/)
  await expect(page.getByRole('heading', { name: 'Квесты', exact: true })).toBeVisible()

  await page.goto(`/play/${setup.questId}`)
  await expect(page).toHaveURL(new RegExp(`participant=${setup.participantProfileId}`))
  await expect(page.getByRole('heading', { name: 'UI participant journey E2E' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать квест' }).click()
  await expect(page.getByRole('heading', { name: 'Задания квеста' })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить с задания 1' }).click()
  await expect(page.getByRole('heading', { name: 'UI E2E task' })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить задание' }).click()

  await expect(page.getByRole('heading', { name: '🏁 Квест завершён!' })).toBeVisible()
  await expect(page.getByText('Завершено заданий: 1 из 1')).toBeVisible()
  await expect(page.getByText('✅ Успешно: 1 | ❌ Неуспешно: 0')).toBeVisible()
  await expect(page.getByText('✅ Результат сохранён и подтверждён сервером')).toBeVisible()

  const serverResult = await page.evaluate(async questId => {
    const { supabase } = await import('/src/supabaseClient.js')
    const result = await supabase
      .from('quest_attempts')
      .select('completed_tasks, failed_tasks, finished_at')
      .eq('quest_id', questId)
      .single()
    if (result.error) throw new Error(result.error.message)
    return result.data
  }, setup.questId)
  expect(serverResult).toMatchObject({ completed_tasks: 1, failed_tasks: 0 })
  expect(serverResult.finished_at).toBeTruthy()

  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js')
    supabase.auth.stopAutoRefresh()
    await supabase.removeAllChannels()
  })
  await page.goto('about:blank')
  await page.context().close()
})

test('manages a dependent profile and group membership through the UI', async ({ page }, testInfo) => {
  test.skip(!process.env.RUN_LOCAL_SUPABASE_E2E, 'requires a running local Supabase stack')
  testInfo.setTimeout(120_000)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const email = `e2e-group-${suffix}@example.test`
  const password = 'Local-group-e2e-password-42'
  const groupName = `E2E group ${suffix}`
  const initialProfileName = `E2E child ${suffix}`
  const renamedProfileName = `E2E participant ${suffix}`

  await page.goto('/login')
  await page.evaluate(async ({ email: userEmail, password: userPassword }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const result = await supabase.auth.signUp({
      email: userEmail,
      password: userPassword,
      options: { data: { username: `Group E2E owner ${userEmail}` } },
    })
    if (result.error) throw new Error(result.error.message)
    if (!result.data.user || !result.data.session) {
      throw new Error('group E2E user session was not created')
    }
    const signOut = await supabase.auth.signOut()
    if (signOut.error) throw new Error(signOut.error.message)
  }, { email, password })

  await page.reload()
  await expectLoginPage(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/quests$/)
  await page.getByRole('link', { name: /Мои группы/ }).click()
  await expect(page).toHaveURL(/\/participants\/group$/)
  await expect(page.getByRole('heading', { name: 'Моя группа' })).toBeVisible()

  const createGroupForm = page.getByRole('heading', { name: 'Создать группу' }).locator('..')
  await createGroupForm.getByLabel('Название').fill(groupName)
  await createGroupForm.getByRole('button', { name: 'Создать группу' }).click()
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()

  const createProfileForm = page.getByRole('heading', { name: 'Добавить участника' }).locator('..')
  await createProfileForm.getByLabel('Имя для отображения').fill(initialProfileName)
  await createProfileForm.getByLabel('Возрастная категория').selectOption('child')
  await createProfileForm.getByLabel('Группа').selectOption({ label: groupName })
  await createProfileForm.getByRole('button', { name: 'Добавить участника' }).click()

  const initialProfileCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: initialProfileName, exact: true }),
  })
  await expect(initialProfileCard).toBeVisible()
  await expect(initialProfileCard.getByText('Ребёнок', { exact: true })).toBeVisible()
  await initialProfileCard.getByRole('button', { name: 'Изменить имя' }).click()
  await initialProfileCard.getByLabel(`Новое имя профиля ${initialProfileName}`).fill(renamedProfileName)
  await initialProfileCard.getByRole('button', { name: 'Сохранить' }).click()

  const renamedProfileCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: renamedProfileName, exact: true }),
  })
  await expect(renamedProfileCard).toBeVisible()

  const groupCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: groupName, exact: true }),
  })
  const participantRow = groupCard.locator('li').filter({ hasText: renamedProfileName })
  await expect(participantRow.getByText('Участник группы', { exact: true })).toBeVisible()
  await participantRow.getByRole('button', { name: 'Удалить' }).click()
  await expect(participantRow).toHaveCount(0)

  await groupCard.getByRole('button', { name: `Добавить: ${renamedProfileName}` }).click()
  await expect(groupCard.locator('li').filter({ hasText: renamedProfileName })).toBeVisible()

  const auditSection = page.getByRole('heading', { name: 'История управления профилями' }).locator('..')
  await expect(auditSection.getByText('Участник добавлен в группу', { exact: true }).first()).toBeVisible()
  await expect(auditSection.getByText('Участник удалён из группы', { exact: true })).toBeVisible()
  await expect(auditSection.getByText(`Профиль: ${renamedProfileName}`, { exact: true }).first()).toBeVisible()

  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js')
    supabase.auth.stopAutoRefresh()
    await supabase.removeAllChannels()
  })
  await page.goto('about:blank')
  await page.context().close()
})

test('rechecks supervision during a real participant grant and retry flow', async ({ page }, testInfo) => {
  test.skip(!process.env.RUN_LOCAL_SUPABASE_E2E, 'requires a running local Supabase stack')
  testInfo.setTimeout(90_000)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `e2e-owner-${suffix}@example.test`
  const adultEmail = `e2e-adult-${suffix}@example.test`
  const password = 'Local-e2e-password-42'

  await page.goto('/login')
  const setup = await page.evaluate(async ({ ownerEmail: email, password: userPassword, adultEmail: invitedEmail }) => {
      const { supabase } = await import('/src/supabaseClient.js')
      const requireData = (result, operation) => {
        if (result.error) throw new Error(`${operation}: ${result.error.message}`)
        return result.data
      }

      const auth = requireData(await supabase.auth.signUp({
        email,
        password: userPassword,
        options: { data: { username: `E2E owner ${email}` } },
      }), 'owner sign up')
      const ownerId = auth.user?.id
      if (!ownerId || !auth.session) throw new Error('owner session was not created')

      const memberships = requireData(await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('status', 'active'), 'load owner organization')
      const organizationId = memberships?.[0]?.organization_id
      if (!organizationId) throw new Error('owner organization was not provisioned')

      const quests = requireData(await supabase.from('quests').insert({
        creator_id: ownerId,
        organization_id: organizationId,
        title: 'E2E participant access',
        is_public: false,
        verification_options: ['code'],
        location_options: ['gps'],
      }).select('id'), 'create quest')
      const questId = quests?.[0]?.id
      const tasks = requireData(await supabase.from('tasks').insert({
        quest_id: questId,
        title: 'E2E task',
      }).select('id'), 'create task')
      const taskId = tasks?.[0]?.id

      const participantProfileId = requireData(await supabase.rpc(
        'create_dependent_participant_profile',
        { p_display_name: 'E2E child', p_age_group: 'child', p_group_id: null }
      ), 'create participant')
      const invitations = requireData(await supabase.rpc(
        'create_participant_profile_invitation',
        {
          p_participant_profile_id: participantProfileId,
          p_invitation_kind: 'supervisor',
          p_email: invitedEmail,
        }
      ), 'create supervisor invitation')
      const credentials = requireData(await supabase.rpc(
        'create_quest_access_credential',
        { p_quest_id: questId, p_kind: 'link', p_email: null, p_max_redemptions: 2 }
      ), 'create quest credential')

      const setupResult = {
        questId,
        taskId,
        participantProfileId,
        invitationToken: invitations?.[0]?.invitation_token,
        accessToken: credentials?.[0]?.credential_token,
      }
      requireData(await supabase.auth.signOut(), 'owner sign out')
      return setupResult
  }, { ownerEmail, password, adultEmail })

  expect(setup.invitationToken).toBeTruthy()
  expect(setup.accessToken).toBeTruthy()

  const participantSession = await page.evaluate(async ({ adultEmail: email, password: userPassword, setup: values }) => {
      const { supabase } = await import('/src/supabaseClient.js')
      const requireData = (result, operation) => {
        if (result.error) throw Object.assign(new Error(`${operation}: ${result.error.message}`), { code: result.error.code })
        return result.data
      }

      const auth = requireData(await supabase.auth.signUp({
        email,
        password: userPassword,
        options: { data: { username: `E2E adult ${email}` } },
      }), 'adult sign up')
      if (!auth.session) throw new Error('adult session was not created')
      requireData(await supabase.rpc('accept_participant_profile_invitation', {
        p_token: values.invitationToken,
      }), 'accept supervision')
      requireData(await supabase.rpc('redeem_quest_access_credential_for_participant', {
        p_token: values.accessToken,
        p_participant_profile_id: values.participantProfileId,
      }), 'redeem quest access')
      const attempts = requireData(await supabase.rpc('start_quest_attempt_for_participant', {
        p_quest_id: values.questId,
        p_participant_profile_id: values.participantProfileId,
      }), 'start participant attempt')
      const sessionResult = { adultId: auth.user.id, attemptId: attempts?.[0]?.id }
      requireData(await supabase.auth.signOut(), 'adult sign out')
      return sessionResult
  }, { adultEmail, password, setup })

  const secondInvitationToken = await page.evaluate(async ({ setup: values, adultId, adultEmail: invitedEmail, ownerEmail: email, password: userPassword }) => {
      const { supabase } = await import('/src/supabaseClient.js')
      const signedIn = await supabase.auth.signInWithPassword({ email, password: userPassword })
      if (signedIn.error) throw new Error(signedIn.error.message)
      const revoked = await supabase.rpc('revoke_participant_supervisor', {
        p_participant_profile_id: values.participantProfileId,
        p_supervisor_user_id: adultId,
      })
      if (revoked.error) throw new Error(revoked.error.message)
      const invitation = await supabase.rpc('create_participant_profile_invitation', {
        p_participant_profile_id: values.participantProfileId,
        p_invitation_kind: 'supervisor',
        p_email: invitedEmail,
      })
      if (invitation.error) throw new Error(invitation.error.message)
      const token = invitation.data?.[0]?.invitation_token
      const signedOut = await supabase.auth.signOut()
      if (signedOut.error) throw new Error(signedOut.error.message)
      return token
  }, { setup, adultId: participantSession.adultId, adultEmail, ownerEmail, password })

  const clientEventId = crypto.randomUUID()
  const denied = await page.evaluate(async ({ setup: values, attemptId, clientEventId: eventId, adultEmail: email, password: userPassword }) => {
      const { supabase } = await import('/src/supabaseClient.js')
      const signedIn = await supabase.auth.signInWithPassword({ email, password: userPassword })
      if (signedIn.error) throw new Error(signedIn.error.message)
      const result = await supabase.rpc('submit_task_event', {
        p_quest_attempt_id: attemptId,
        p_task_id: values.taskId,
        p_client_event_id: eventId,
        p_event_type: 'open',
      })
      return { code: result.error?.code, message: result.error?.message }
  }, { setup, attemptId: participantSession.attemptId, clientEventId, adultEmail, password })
  expect(denied).toMatchObject({ code: '42501' })

  const restored = await page.evaluate(async ({ token, setup: values, attemptId, clientEventId: eventId }) => {
      const { supabase } = await import('/src/supabaseClient.js')
      const accepted = await supabase.rpc('accept_participant_profile_invitation', { p_token: token })
      if (accepted.error) throw new Error(accepted.error.message)
      const payload = {
        p_quest_attempt_id: attemptId,
        p_task_id: values.taskId,
        p_client_event_id: eventId,
        p_event_type: 'open',
      }
      const first = await supabase.rpc('submit_task_event', payload)
      const retry = await supabase.rpc('submit_task_event', payload)
      if (first.error) throw new Error(first.error.message)
      if (retry.error) throw new Error(retry.error.message)
      return { first: first.data, retry: retry.data }
  }, { token: secondInvitationToken, setup, attemptId: participantSession.attemptId, clientEventId })

  expect(restored.first).toEqual(restored.retry)
  expect(restored.first).toMatchObject({ accepted: true, opened: true })

  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabaseClient.js')
    supabase.auth.stopAutoRefresh()
    await supabase.removeAllChannels()
  })
  await page.goto('about:blank')
})

test('redeems a short code through the local edge gateway', async ({ page }, testInfo) => {
  test.skip(!process.env.RUN_LOCAL_EDGE_E2E, 'requires the local Supabase Edge Runtime')
  testInfo.setTimeout(60_000)
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const password = 'Local-edge-e2e-password-42'
  const ownerEmail = `edge-owner-${suffix}@example.test`
  const participantEmail = `edge-participant-${suffix}@example.test`

  const preflight = await page.request.fetch(
    'http://127.0.0.1:54321/functions/v1/redeem-quest-code',
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:4173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-qvesta-device-id',
      },
    },
  )
  expect(preflight.status()).toBe(200)
  const allowedHeaders = preflight.headers()['access-control-allow-headers']
  expect(allowedHeaders).toContain('x-client-info')
  expect(allowedHeaders).toContain('x-supabase-api-version')
  expect(allowedHeaders).toContain('x-qvesta-device-id')

  await page.goto('/login')
  const code = await page.evaluate(async ({ email, password: userPassword }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const auth = await supabase.auth.signUp({
      email, password: userPassword, options: { data: { username: `Edge owner ${email}` } },
    })
    if (auth.error || !auth.data.user) throw new Error(auth.error?.message || 'owner signup failed')
    const membership = await supabase.from('organization_memberships').select('organization_id').eq('status', 'active').limit(1).single()
    if (membership.error) throw new Error(membership.error.message)
    const quest = await supabase.from('quests').insert({
      creator_id: auth.data.user.id,
      organization_id: membership.data.organization_id,
      title: 'Edge gateway E2E',
      is_public: false,
    }).select('id').single()
    if (quest.error) throw new Error(quest.error.message)
    const credential = await supabase.rpc('create_quest_access_credential', {
      p_quest_id: quest.data.id, p_kind: 'code', p_email: null, p_max_redemptions: 1,
    }).single()
    if (credential.error) throw new Error(credential.error.message)
    await supabase.auth.signOut()
    return credential.data.credential_token
  }, { email: ownerEmail, password })

  const result = await page.evaluate(async ({ email, password: userPassword, code: accessCode }) => {
    const { supabase } = await import('/src/supabaseClient.js')
    const auth = await supabase.auth.signUp({
      email, password: userPassword, options: { data: { username: `Edge participant ${email}` } },
    })
    if (auth.error || !auth.data.session) throw new Error(auth.error?.message || 'participant signup failed')
    const profiles = await supabase.rpc('get_my_participant_profiles')
    if (profiles.error) throw new Error(profiles.error.message)
    const selfProfile = profiles.data.find(profile => profile.relationship === 'self')
    const { redeemQuestAccessCode } = await import('/src/services/questAccessApi.js')
    return redeemQuestAccessCode(accessCode, selfProfile.participant_profile_id)
  }, { email: participantEmail, password, code })

  expect(result).toMatchObject({ success: true })
})
