import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

let server, origin
const pageErrors = new WeakMap()
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import QuestPlay from '/src/pages/QuestPlay.jsx';
import * as db from '/src/services/db.js';
window.db = db;
const root = createRoot(document.getElementById('root'));
window.renderPlay = (actor, path = '/play/QA?participant=PA') => root.render(
  React.createElement(MemoryRouter, {key: path, initialEntries: [path]},
    React.createElement(Routes, null, React.createElement(Route, {
      path: '/play/:id', element: React.createElement(QuestPlay, {
        session: actor ? {user: {id: actor}} : null,
      }),
    })))
);
window.online = false;
Object.defineProperty(navigator, 'onLine', {get: () => window.online, configurable: true});
window.createdUrls = []; window.revokedUrls = [];
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); window.createdUrls.push(url); return url; };
URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke(url); };
window.ready = true;
`

const client = `
export const supabase = {
  rpc(name) {
    let result;
    if (window.transportFailure) {
      result = Promise.reject(new TypeError('Failed to fetch'));
    } else if (name === 'get_my_participant_profiles') {
      result = window.deferProfiles
        ? new Promise(resolve => { window.resolveProfiles = resolve; })
        : Promise.resolve({ data: window.serverProfiles || [], error: null });
    } else if (name === 'get_quest_entry_status') {
      result = Promise.resolve({ data: {id: 'QA', is_open: true}, error: null });
    } else if (window.serverQuest && name === 'get_participant_quest_for_profile') {
      result = Promise.resolve({data: window.serverQuest, error: null});
    } else if (window.serverQuest && name === 'get_participant_tasks_for_profile') {
      result = Promise.resolve({data: window.serverQuest.tasks, error: null});
    } else if (window.serverQuest && name === 'get_participant_quest_summary') {
      result = Promise.resolve({data: {}, error: null});
    } else {
      result = Promise.resolve({ data: null, error: {code: '42501', message: 'quest access denied'} });
    }
    result.single = () => result;
    result.abortSignal = () => result;
    return result;
  },
  auth: {getSession: async () => ({data: {session: null}})},
};
`

test.beforeAll(async () => {
  server = await createServer({
    configFile: false, envDir: false, root: process.cwd(), cacheDir: '.offline-vite-cache.local',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'synthetic-offline-access', enforce: 'pre',
      resolveId(id) {
        if (id === '/fixture.js') return '\0offline-fixture'
        if (/\/supabaseClient(?:\.js)?$/.test(id)) return '\0synthetic-client'
      },
      load(id) {
        if (id === '\0offline-fixture') return fixture
        if (id === '\0synthetic-client') return client
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/review') return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml('/review', '<div id="root"></div><script type="module" src="/fixture.js"></script>'))
        })
      },
    }, react()],
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
})

test.afterAll(async () => { await server?.close() })

test.beforeEach(async ({ page }, testInfo) => {
  pageErrors.set(page, [])
  page.on('pageerror', error => pageErrors.get(page).push(error.message))
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`)
    ? route.continue() : route.abort())
  await page.goto(`${origin}/review`)
  await page.waitForFunction(() => window.ready)
  if (testInfo.title === 'v14 migration preserves grants, pending, review, permits and media after reload') return
  await page.evaluate(async () => {
    const d = await window.db.initDB(), now = new Date().toISOString()
    await window.db.saveParticipantProfiles('A', [{participant_profile_id: 'PA', display_name: 'Profile A', relationship: 'self'}])
    await d.put('quests', {
      id: 'QA', title: 'PRIVATE QUEST A', description: 'PRIVATE DESCRIPTION A',
      is_public: false, is_open: true, verification_mode: 'hybrid',
      offline_progress_policy: 'allow_pending', offline_start_requires_permit: true,
      participantAccess: {PA: now}, tasks: [{id: 'TA', title: 'PRIVATE TASK A', type: 'text'}],
      offlineAssetRefs: [{field: 'cover_image_url', assetId: 'MA'}],
    })
    await d.put('downloadedQuests', {questId: 'QA', downloadedAt: now, packageVersion: 2})
    await d.put('offlineAssets', {id: 'MA', questId: 'QA', blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>'], {type: 'image/svg+xml'})})
    await window.db.saveQuestAttempt('LA', 'QA', 'A', null, false, false, 'PA')
    await window.db.enqueuePendingEvent('QA', 'TA', 'LA', {eventType: 'answer', submittedValue: 'synthetic answer'})
    const pending = (await window.db.getPendingResults('A'))[0]
    await d.put('pendingResults', {...pending, id: 2, clientEventId: 'synthetic-review-event', reviewState: 'needs_review', reviewReceiptId: 'synthetic-receipt'})
    await window.db.saveOfflineStartPermit('A', 'PA', 'QA', {id: 'permit-A', quest_id: 'QA', participant_profile_id: 'PA', state: 'reserved'})
  })
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([])
})

async function expectBlocked(page) {
  await expect(page.getByText(/Квест недоступен|Не удалось загрузить квест\. Попробуйте ещё раз\./).first()).toBeVisible()
  await expect(page.getByText('PRIVATE QUEST A', {exact: true})).toHaveCount(0)
  await expect(page.getByText('PRIVATE DESCRIPTION A', {exact: true})).toHaveCount(0)
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0)
}

test('reader denies missing actor/profile and foreign membership before media hydration', async ({ page }) => {
  const result = await page.evaluate(async () => ({
    noActor: await db.getQuestFromDB('QA', 'PA'),
    noProfile: await db.getQuestFromDB('QA', null, 'A'),
    foreign: await db.getQuestFromDB('QA', 'PA', 'B'),
    wrong: await db.getQuestFromDB('QA', 'PB', 'A'),
    urls: window.createdUrls,
  }))
  expect(result).toEqual({noActor: null, noProfile: null, foreign: null, wrong: null, urls: []})
})

for (const path of ['/play/QA?participant=PA', '/play/QA']) {
  test(`B cannot open A content: ${path}`, async ({ page }) => {
    await page.evaluate(path => window.renderPlay('B', path), path)
    await expectBlocked(page)
    expect(await page.evaluate(() => window.createdUrls)).toEqual([])
  })
}

for (const path of ['/play/QA?participant=PA', '/play/QA']) {
  test(`expired owner access cannot bypass TTL: ${path}`, async ({ page }) => {
    await page.evaluate(async path => {
      const d = await db.initDB(), q = await d.get('quests', 'QA')
      q.participantAccess.PA = new Date(Date.now() - 48 * 3600000).toISOString()
      await d.put('quests', q)
      window.renderPlay('A', path)
    }, path)
    await expectBlocked(page)
    expect(await page.evaluate(() => db.getQuestFromDB('QA', 'PA', 'A'))).toBeNull()
    expect(await page.evaluate(() => window.createdUrls)).toEqual([])
  })
}

test('fresh owner content and cover work, including implicit verified self selection', async ({ page }) => {
  await page.evaluate(() => window.renderPlay('A', '/play/QA'))
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(1)
  await expect(page.getByRole('option', {name: 'Profile A'})).toBeAttached()
})

test('supervisor and group manager retain server-authorized profile access', async ({ page }) => {
  for (const role of [{relationship: 'supervised', supervision_status: 'active'}, {relationship: 'group_manager'}]) {
    const title = await page.evaluate(async role => {
      await db.saveParticipantProfiles('B', [{participant_profile_id: 'PA', ...role}])
      return (await db.getQuestFromDB('QA', 'PA', 'B'))?.title
    }, role)
    expect(title).toBe('PRIVATE QUEST A')
  }
})

test('revoked membership and old attempt never confer access; pending/review/permit survive reload', async ({ page }) => {
  await page.evaluate(async () => { await db.saveParticipantProfiles('A', []); window.renderPlay('A') })
  await expectBlocked(page)
  await page.reload()
  await page.waitForFunction(() => window.ready)
  const state = await page.evaluate(async () => {
    const d = await db.initDB()
    return {quest: await db.getQuestFromDB('QA', 'PA', 'A'), attempt: await db.getQuestAttempt('LA'),
      pending: await db.getPendingResults('A'), otherPending: await db.getPendingResults('B'),
      permit: await d.get('offlineStartPermits', ['A', 'PA', 'QA']), asset: Boolean(await d.get('offlineAssets', 'MA'))}
  })
  expect(state.quest).toBeNull()
  expect(state.attempt).toMatchObject({userId: 'A', participantProfileId: 'PA', finished: false})
  expect(state.pending).toHaveLength(2)
  expect(state.pending[0]).toMatchObject({userId: 'A', submittedValue: 'synthetic answer', synced: false})
  expect(state.pending[1]).toMatchObject({userId: 'A', submittedValue: 'synthetic answer', synced: false, reviewState: 'needs_review', reviewReceiptId: 'synthetic-receipt'})
  expect(state.otherPending).toEqual([])
  expect(state.permit.permitId).toBe('permit-A')
  expect(state.asset).toBe(true)
})

test('known online quest denial revokes cached entitlement for later offline reads', async ({ page }) => {
  await page.evaluate(() => {
    window.online = true
    window.serverProfiles = [{participant_profile_id: 'PA', relationship: 'self'}]
    window.renderPlay('A')
  })
  await expectBlocked(page)
  expect(await page.evaluate(() => db.getQuestFromDB('QA', 'PA', 'A'))).toBeNull()
  expect(await page.evaluate(() => window.createdUrls)).toEqual([])
  expect(await page.evaluate(async () => (await db.getPendingResults('A')).length)).toBe(2)
})

test('authoritative empty online profile list replaces cached membership', async ({ page }) => {
  await page.evaluate(() => { window.online = true; window.serverProfiles = []; window.renderPlay('A') })
  await expectBlocked(page)
  expect(await page.evaluate(() => db.getParticipantProfiles('A'))).toEqual([])
  expect(await page.evaluate(() => db.getQuestFromDB('QA', 'PA', 'A'))).toBeNull()
})

test('account switch and logout remove rendered content and revoke object URLs', async ({ page }) => {
  await page.evaluate(() => window.renderPlay('A'))
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  await page.evaluate(() => window.renderPlay(null))
  await expectBlocked(page)
  await page.evaluate(() => window.renderPlay('B'))
  await expectBlocked(page)
  const urls = await page.evaluate(() => ({created: window.createdUrls, revoked: window.revokedUrls}))
  expect(urls.created.length).toBeGreaterThan(0)
  expect(urls.created.every(url => urls.revoked.includes(url))).toBe(true)
})

test('direct A to B switch in the same mounted router removes stale content', async ({ page }) => {
  await page.evaluate(() => window.renderPlay('A'))
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  await page.evaluate(() => window.renderPlay('B'))
  await expectBlocked(page)
})

test('late profile response from A cannot populate B UI or cache', async ({ page }) => {
  await page.evaluate(() => { window.online = true; window.deferProfiles = true; window.renderPlay('A') })
  await page.waitForFunction(() => Boolean(window.resolveProfiles))
  await page.evaluate(() => { window.online = false; window.renderPlay('B') })
  await expectBlocked(page)
  await page.evaluate(() => window.resolveProfiles({data: [{participant_profile_id: 'PA', relationship: 'self'}], error: null}))
  await expectBlocked(page)
  expect(await page.evaluate(() => db.getParticipantProfiles('B'))).toEqual([])
  expect(await page.evaluate(() => db.getParticipantProfiles('A'))).toMatchObject([{display_name: 'Profile A'}])
  expect(await page.evaluate(() => window.createdUrls)).toEqual([])
})

test('canceled cache read does not create an object URL', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const controller = new AbortController()
    const read = db.getQuestFromDB('QA', 'PA', 'A', controller.signal)
    controller.abort()
    try { await read; return false } catch (error) { return error.name === 'AbortError' && window.createdUrls.length === 0 }
  })).toBe(true)
})

test('owner with an unavailable network can use a fresh previously verified package', async ({ page }) => {
  await page.evaluate(() => { window.online = true; window.transportFailure = true; window.renderPlay('A') })
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(1)
})

test('wrong requested profile is not replaced by a URL fallback', async ({ page }) => {
  await page.evaluate(() => window.renderPlay('A', '/play/QA?participant=PB'))
  await expectBlocked(page)
  expect(await page.evaluate(() => window.createdUrls)).toEqual([])
})

test('verified online owner can refresh and then reopen the package offline', async ({ page }) => {
  await page.evaluate(async () => {
    window.online = true
    window.serverProfiles = [{participant_profile_id: 'PA', relationship: 'self'}]
    window.serverQuest = await (await db.initDB()).get('quests', 'QA')
    window.renderPlay('A')
  })
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  await page.reload()
  await page.waitForFunction(() => window.ready)
  await page.evaluate(() => window.renderPlay('A'))
  await expect(page.getByRole('heading', {name: 'PRIVATE QUEST A', exact: true})).toBeVisible()
  expect(await page.evaluate(async () => (await db.getPendingResults('A')).length)).toBe(2)
})

test('inactive cached supervision does not grant content access', async ({ page }) => {
  await page.evaluate(async () => {
    await db.saveParticipantProfiles('B', [{participant_profile_id: 'PA', relationship: 'supervised', supervision_status: 'revoked'}])
    window.renderPlay('B')
  })
  await expectBlocked(page)
  expect(await page.evaluate(() => db.getQuestFromDB('QA', 'PA', 'B'))).toBeNull()
  expect(await page.evaluate(() => window.createdUrls)).toEqual([])
})

for (const refreshProfile of ['PB', 'PA']) {
  test(`media-delayed refresh for ${refreshProfile} cannot restore revoked PA access`, async ({ page }) => {
    await page.evaluate(async refreshProfile => {
      await db.saveParticipantProfiles('B', [{participant_profile_id: 'PB', relationship: 'self'}])
      window.beforePending = JSON.stringify(await db.getPendingResults('A'))
      const originalFetch = window.fetch
      window.fetch = (url, ...args) => String(url).endsWith('/slow-cover.svg')
        ? new Promise(resolve => { window.releaseMedia = () => resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {headers: {'Content-Type': 'image/svg+xml'}})) })
        : originalFetch(url, ...args)
      const quest = await (await db.initDB()).get('quests', 'QA')
      window.refreshResult = db.saveQuestToDB({ ...quest, title: 'SYNTHETIC REFRESH', cover_image_url: `${location.origin}/slow-cover.svg` }, quest.tasks, refreshProfile)
        .then(() => 'saved', error => error.code)
    }, refreshProfile)
    await page.waitForFunction(() => Boolean(window.releaseMedia))
    expect(await page.evaluate(async () => {
      await db.revokeParticipantPackageAccess('QA', 'PA')
      return db.getQuestFromDB('QA', 'PA', 'A')
    })).toBeNull()
    await page.evaluate(() => window.releaseMedia())
    expect(await page.evaluate(() => window.refreshResult)).toBe(refreshProfile === 'PB' ? 'saved' : 'OFFLINE_PACKAGE_ACCESS_REVOKED')
    const state = await page.evaluate(async () => ({
      revoked: await db.getQuestFromDB('QA', 'PA', 'A'),
      other: (await db.getQuestFromDB('QA', 'PB', 'B'))?.title,
      unchangedPending: JSON.stringify(await db.getPendingResults('A')) === window.beforePending,
      attempt: await db.getQuestAttempt('LA'),
      permit: await (await db.initDB()).get('offlineStartPermits', ['A', 'PA', 'QA']),
    }))
    expect(state.revoked).toBeNull()
    expect(state.other).toBe(refreshProfile === 'PB' ? 'SYNTHETIC REFRESH' : undefined)
    expect(state.unchangedPending).toBe(true)
    expect(state.attempt.userId).toBe('A')
    expect(state.permit.permitId).toBe('permit-A')
    await page.reload()
    await page.waitForFunction(() => window.ready)
    expect(await page.evaluate(() => db.getQuestFromDB('QA', 'PA', 'A'))).toBeNull()
  })
}

for (const questId of ['QA', 'not-yet-downloaded']) {
  test(`late same-profile authorization response stays revoked: ${questId}`, async ({ page }) => {
    const state = await page.evaluate(async questId => {
      const request = await db.beginParticipantPackageRefresh(questId, 'PA')
      await db.revokeParticipantPackageAccess(questId, 'PA')
      let rejected
      try { await db.saveQuestToDB({id: questId, title: 'STALE RESPONSE'}, [], 'PA', null, request) }
      catch (error) { rejected = error.code }
      const blocked = await db.getQuestFromDB(questId, 'PA', 'A')
      // A later, newly verified request may restore access. The old response still cannot overwrite it.
      const fresh = await db.beginParticipantPackageRefresh(questId, 'PA')
      await db.saveQuestToDB({id: questId, title: 'NEW AUTHORIZATION'}, [], 'PA', null, fresh)
      try { await db.saveQuestToDB({id: questId, title: 'STALE RETRY'}, [], 'PA', null, request) } catch { /* expected */ }
      return {rejected, blocked, title: (await db.getQuestFromDB(questId, 'PA', 'A'))?.title}
    }, questId)
    expect(state).toEqual({rejected: 'OFFLINE_PACKAGE_ACCESS_REVOKED', blocked: null, title: 'NEW AUTHORIZATION'})
  })
}

test('v14 migration preserves grants, pending, review, permits and media after reload', async ({ page }) => {
  const migrated = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('QuestPlatformDB', 14)
      request.onupgradeneeded = () => {
        const d = request.result
        d.createObjectStore('quests', {keyPath: 'id'})
        d.createObjectStore('participantProfiles', {keyPath: 'userId'})
        d.createObjectStore('pendingResults', {keyPath: 'id', autoIncrement: true})
        d.createObjectStore('questAttempts', {keyPath: 'localId'})
        d.createObjectStore('offlineAssets', {keyPath: 'id'})
        d.createObjectStore('offlineStartPermits', {keyPath: ['userId', 'participantProfileId', 'questId']})
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const d = request.result, tx = d.transaction([...d.objectStoreNames], 'readwrite')
        tx.objectStore('quests').put({id: 'QA', title: 'v14 owner content', participantAccess: {PA: new Date().toISOString()}, tasks: [], offlineAssetRefs: [{field: 'cover_image_url', assetId: 'MA'}]})
        tx.objectStore('participantProfiles').put({userId: 'A', profiles: [{participant_profile_id: 'PA', relationship: 'self'}]})
        tx.objectStore('questAttempts').put({localId: 'LA', questId: 'QA', userId: 'A', participantProfileId: 'PA', finished: false, synced: false})
        tx.objectStore('pendingResults').put({id: 1, questId: 'QA', localQuestAttemptId: 'LA', userId: 'A', participantProfileId: 'PA', clientEventId: 'old-event', submittedValue: 'preserved', synced: false, reviewState: 'needs_review', reviewReceiptId: 'old-receipt'})
        tx.objectStore('offlineAssets').put({id: 'MA', questId: 'QA', blob: new Blob(['old-media'])})
        tx.objectStore('offlineStartPermits').put({userId: 'A', participantProfileId: 'PA', questId: 'QA', permitId: 'old-permit'})
        tx.oncomplete = () => { d.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    const d = await db.initDB()
    return {version: d.version, quest: await d.get('quests', 'QA')}
  })
  expect(migrated.version).toBe(15)
  expect(migrated.quest.participantAccessRevisions).toEqual({})
  expect(migrated.quest.participantAccess.PA).toBeTruthy()
  await page.reload()
  await page.waitForFunction(() => window.ready)
  const state = await page.evaluate(async () => {
    const d = await db.initDB()
    return {quest: await db.getQuestFromDB('QA', 'PA', 'A'), pending: await db.getPendingResults('A'), attempt: await db.getQuestAttempt('LA'), permit: await d.get('offlineStartPermits', ['A', 'PA', 'QA']), asset: Boolean(await d.get('offlineAssets', 'MA'))}
  })
  expect(state.quest.title).toBe('v14 owner content')
  expect(state.quest.cover_image_url).toMatch(/^blob:/)
  expect(state.pending).toMatchObject([{clientEventId: 'old-event', submittedValue: 'preserved', synced: false, reviewState: 'needs_review', reviewReceiptId: 'old-receipt'}])
  expect(state.attempt).toMatchObject({localId: 'LA', userId: 'A', finished: false, synced: false})
  expect(state.permit.permitId).toBe('old-permit')
  expect(state.asset).toBe(true)
})
