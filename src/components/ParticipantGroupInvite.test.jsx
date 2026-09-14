import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { create, save } = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }))
vi.mock('../services/participantGroupApi', () => ({ createParticipantGroupInvitation: create }))
vi.mock('../services/localSecretLinks', () => ({ saveLocalSecretLink: save }))
import ParticipantGroupInvite from './ParticipantGroupInvite'
const receipt = { invitation_id: 'i1', invitation_token: 'synthetic-token', expires_at: '2026-09-21T12:00:00Z' }
beforeEach(() => { create.mockReset(); save.mockReset(); save.mockResolvedValue({}) })
function setup() {
  render(<MemoryRouter><ParticipantGroupInvite groupId="g1" onClose={() => {}} /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Email получателя'), { target: { value: 'demo@example.test' } })
  return screen.getByRole('button', { name: 'Создать приглашение' }).closest('form')
}
it('отправляет один запрос при двойной отправке', async () => {
  let finish
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const form = setup()
  fireEvent.submit(form); fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith({ groupId: 'g1', email: 'demo@example.test' })
  await act(async () => finish(receipt))
  expect(screen.getByLabelText('Ссылка приглашения').value).toContain('synthetic-token')
  expect(save).toHaveBeenCalledTimes(1)
})
it('сбой локального сохранения не теряет полученную ссылку и не повторяет RPC', async () => {
  create.mockResolvedValue(receipt); save.mockRejectedValue(new Error('storage failed'))
  fireEvent.submit(setup())
  await screen.findByText(/ссылка не сохранена на устройстве/)
  expect(screen.getByLabelText('Ссылка приглашения').value).toContain('synthetic-token')
  expect(screen.queryByRole('button', { name: 'Создать приглашение' })).toBeNull()
  expect(create).toHaveBeenCalledTimes(1)
})
it('потеря ответа блокирует повтор и предлагает проверить приглашения', async () => {
  create.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = setup(); fireEvent.submit(form)
  await screen.findByRole('link', { name: 'Ранее созданные приглашения' })
  fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(save).not.toHaveBeenCalled()
})
it('существующее приглашение показывает понятный отказ без ложного успеха', async () => {
  create.mockRejectedValue({ code: '23505' })
  fireEvent.submit(setup())
  await screen.findByText(/уже есть ожидающее приглашение/)
  expect(screen.queryByLabelText('Ссылка приглашения')).toBeNull()
})
