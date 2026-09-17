import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ accept: vi.fn(), preview: vi.fn(), check: vi.fn(), adopt: vi.fn() }))
vi.mock('../services/participantGroupApi', () => ({ acceptParticipantProfileInvitation: mocks.accept, previewParticipantProfileInvitation: mocks.preview }))
vi.mock('../services/participantClaimPreflight', () => ({ checkParticipantClaimPending: mocks.check }))
vi.mock('../services/db', () => ({ adoptParticipantOfflineData: mocks.adopt }))
import AcceptParticipantInvitation from './AcceptParticipantInvitation'
beforeEach(() => { vi.resetAllMocks(); mocks.preview.mockResolvedValue({ invitation_kind: 'claim', participant_display_name: 'Участник' }); mocks.accept.mockResolvedValue({ participant_profile_id: 'target' }); mocks.check.mockResolvedValue(0) })
async function open() {
  render(<MemoryRouter initialEntries={['/?token=test']}><AcceptParticipantInvitation session={{ user: { id: 'user' } }} /></MemoryRouter>)
  return screen.findByRole('button', { name: 'Принять приглашение' })
}
it('не вызывает claim до синхронизации, повтор проверяет очередь заново', async () => {
  mocks.check.mockResolvedValueOnce(2)
  fireEvent.click(await open())
  await screen.findByText(/Объединение отложено/)
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Открыть загрузки и синхронизацию' })).toHaveAttribute('href', '/downloads')
  fireEvent.click(screen.getByRole('button', { name: 'Принять приглашение' }))
  await waitFor(() => expect(mocks.accept).toHaveBeenCalledTimes(1))
})
it('ошибка проверки оставляет приглашение доступным для повтора', async () => {
  mocks.check.mockRejectedValue(new Error('private detail'))
  fireEvent.click(await open())
  await screen.findByText(/Не удалось проверить неотправленные результаты/)
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Принять приглашение' })).toBeEnabled()
})
it('приглашение контролирующего взрослого не блокируется очередью self', async () => {
  mocks.preview.mockResolvedValue({ invitation_kind: 'supervisor' })
  fireEvent.click(await open())
  await screen.findByText('Вы добавлены как контролирующий взрослый.')
  expect(mocks.check).not.toHaveBeenCalled()
})
