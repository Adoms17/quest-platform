import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), quests: vi.fn(), packages: vi.fn(), attempts: vi.fn(), pending: vi.fn(), cached: vi.fn(), saveProfiles: vi.fn(), quest: vi.fn(), tasks: vi.fn(), save: vi.fn() }))
vi.mock('./db', () => ({ OFFLINE_PACKAGE_VERSION: 2, getDownloadedQuestPackages: mocks.packages, getLocalParticipantAttempts: mocks.attempts, getParticipantProfiles: mocks.cached, getPendingResults: mocks.pending, saveParticipantProfiles: mocks.saveProfiles, saveQuestToDB: mocks.save }))
vi.mock('./participantGroupApi', () => ({ listMyParticipantProfiles: mocks.profiles }))
vi.mock('./questApi', () => ({ listAccessiblePrivateQuests: mocks.quests, loadParticipantQuest: mocks.quest, loadParticipantTasks: mocks.tasks }))
import { packageReadiness, buildParticipantQuestRows, loadParticipantDashboard, downloadParticipantQuest } from './participantDashboard'
const profile = { participant_profile_id: 'p1', display_name: 'Саша', relationship: 'self' }
const pkg = { questId: 'q1', participantProfileId: 'p1', title: 'Квест', packageVersion: 2, isFresh: true, expiresAt: '2026-10-01', is_open: true }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  mocks.profiles.mockResolvedValue([profile]); mocks.quests.mockResolvedValue([]); mocks.cached.mockResolvedValue([profile])
  mocks.packages.mockResolvedValue([pkg]); mocks.attempts.mockResolvedValue([]); mocks.pending.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())
describe('готовность и изоляция участника', () => {
  it('не обещает offline для просроченного, неполного, старого или закрытого пакета', () => {
    const now = Date.parse('2026-09-14')
    expect(packageReadiness(pkg, now).ready).toBe(true)
    for (const change of [{ expiresAt: '2026-09-01' }, { expiresAt: 'bad' }, { offlineMediaFailures: [{}] }, { packageVersion: 1 }, { is_open: false }, { end_at: '2026-09-01' }, { start_at: '2026-10-01' }]) expect(packageReadiness({ ...pkg, ...change }, now).ready).toBe(false)
  })
  it('объединяет пакет и серверный квест ровно один раз и не смешивает профили', () => {
    const data = { profiles: [profile], quests: [{ quest_id: 'q1', title: 'Серверное название', participants: [profile] }], packages: [pkg, { ...pkg, questId: 'foreign', participantProfileId: 'p2' }], attempts: [{ questId: 'q1', participantProfileId: 'p2', finished: false }], pending: [{ questId: 'q1', participantProfileId: 'p2' }] }
    const rows = buildParticipantQuestRows(data, 'p1', Date.parse('2026-09-14'))
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ title: 'Серверное название', attempt: null, pendingCount: 0 })
    expect(buildParticipantQuestRows(data, 'p2')).toEqual([])
  })
  it('оставляет локальную копию без обещания серверного доступа и не возобновляет finished', () => {
    const data = { profiles: [profile], quests: [], packages: [pkg], attempts: [{ questId: 'q1', participantProfileId: 'p1', finished: true }], pending: [{ questId: 'q1', participantProfileId: 'p1' }] }
    expect(buildParticipantQuestRows(data, 'p1')[0]).toMatchObject({ remote: false, attempt: null, pendingCount: 1 })
  })
  it('при отказе сервера не использует кеш как разрешение', async () => {
    mocks.profiles.mockRejectedValue({ code: '42501' })
    await expect(loadParticipantDashboard('u1', new AbortController().signal)).rejects.toMatchObject({ code: '42501' })
    expect(mocks.cached).not.toHaveBeenCalled()
  })
  it('не предлагает продолжение после локального события завершения', () => {
    const data = { profiles: [profile], quests: [], packages: [pkg], attempts: [{ localId: 'a1', questId: 'q1', participantProfileId: 'p1', finished: false }], pending: [{ localQuestAttemptId: 'a1', questId: 'q1', participantProfileId: 'p1', eventType: 'finish' }] }
    expect(buildParticipantQuestRows(data, 'p1')[0]).toMatchObject({ attempt: null, pendingCount: 1 })
  })
  it('при сетевой ошибке использует только кеш аккаунта, сохраняя pending отозванного профиля', async () => {
    mocks.profiles.mockRejectedValue(new TypeError('Failed to fetch'))
    mocks.packages.mockResolvedValue([pkg, { ...pkg, participantProfileId: 'other' }])
    mocks.pending.mockResolvedValue([{ userId: 'u1', participantProfileId: 'revoked', synced: false }])
    const data = await loadParticipantDashboard('u1', new AbortController().signal)
    expect(data.offline).toBe(true); expect(data.packages).toEqual([pkg]); expect(data.pending).toHaveLength(1)
    expect(mocks.cached).toHaveBeenCalledWith('u1'); expect(mocks.pending).toHaveBeenCalledWith('u1')
  })
  it('скачивание проверяет оба RPC для выбранного профиля и не создаёт попытку', async () => {
    mocks.quest.mockResolvedValue({ id: 'q1' }); mocks.tasks.mockResolvedValue([]); mocks.save.mockResolvedValue({})
    const signal = new AbortController().signal
    await downloadParticipantQuest('q1', 'p1', signal)
    expect(mocks.quest).toHaveBeenCalledWith('q1', 'p1', signal)
    expect(mocks.tasks).toHaveBeenCalledWith('q1', 'p1', signal)
    expect(mocks.save).toHaveBeenCalledWith({ id: 'q1' }, [], 'p1', signal)
  })
  it('отмена между проверкой доступа и записью не сохраняет пакет', async () => {
    const controller = new AbortController()
    mocks.quest.mockResolvedValue({ id: 'q1' }); mocks.tasks.mockImplementation(() => { controller.abort(); return [] })
    await expect(downloadParticipantQuest('q1', 'p1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
