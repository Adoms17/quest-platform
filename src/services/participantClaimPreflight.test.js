import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), pending: vi.fn() }))
vi.mock('./participantGroupApi', () => ({ listMyParticipantProfiles: mocks.profiles }))
vi.mock('./db', () => ({ getPendingResults: mocks.pending }))
import { checkParticipantClaimPending } from './participantClaimPreflight'
beforeEach(() => { vi.resetAllMocks(); mocks.profiles.mockResolvedValue([{ relationship: 'self', participant_profile_id: 'own' }]); mocks.pending.mockResolvedValue([]) })
it('считает только неотправленные события исходного профиля', async () => {
  mocks.pending.mockResolvedValue([{ participantProfileId: 'own' }, { participantProfileId: 'child' }, { participantProfileId: 'own', synced: true }])
  expect(await checkParticipantClaimPending('user')).toBe(1)
  expect(mocks.pending).toHaveBeenCalledWith('user')
})
it('после синхронизации повторная проверка разрешает продолжение', async () => {
  mocks.pending.mockResolvedValueOnce([{ participantProfileId: 'own' }])
  expect(await checkParticipantClaimPending('user')).toBe(1)
  expect(await checkParticipantClaimPending('user')).toBe(0)
})
it('подтверждённый серверный архив не блокирует перенос профиля', async () => {
  mocks.pending.mockResolvedValue([{ participantProfileId: 'own', synced: false, reviewState: 'needs_review', reviewReceiptId: 'receipt' }])
  expect(await checkParticipantClaimPending('user')).toBe(0)
})
it.each([[], [{ relationship: 'self' }], [{ relationship: 'self', participant_profile_id: 'a' }, { relationship: 'self', participant_profile_id: 'b' }]].map(profiles => ({ profiles })))('не принимает неопределённый self за пустую очередь: $profiles', async ({ profiles }) => {
  mocks.profiles.mockResolvedValue(profiles)
  await expect(checkParticipantClaimPending('user')).rejects.toThrow()
})
it('не принимает ошибку IndexedDB за пустую очередь', async () => {
  mocks.pending.mockRejectedValue(new Error('storage unavailable'))
  await expect(checkParticipantClaimPending('user')).rejects.toThrow()
})
it('не пропускает событие с неизвестным профилем', async () => {
  mocks.pending.mockResolvedValue([{}])
  await expect(checkParticipantClaimPending('user')).rejects.toThrow()
})
