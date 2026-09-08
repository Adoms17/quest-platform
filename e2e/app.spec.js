import { expect, test } from '@playwright/test'

function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error))
  return errors
}

async function expectLoginPage(page) {
  await expect(page.getByRole('heading', { name: 'Quest Platform' })).toBeVisible()
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByPlaceholder('Пароль')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible()
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

test('rechecks supervision during a real participant grant and retry flow', async ({ page }, testInfo) => {
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
