import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { create, save } = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }))
vi.mock('../services/teamApi', () => ({ createOrganizationInvitation: create, listAssignableOrganizationRoles: async () => [{ key: 'host', name: 'Ведущий' }] }))
vi.mock('../services/localSecretLinks', () => ({ saveLocalSecretLink: save }))
import OrganizationInvite from './OrganizationInvite'
const receipt = { invitation_id: 'i1', invitation_token: 'synthetic-token', expires_at: '2026-09-21T12:00:00Z' }
beforeEach(() => { create.mockReset(); save.mockReset(); save.mockResolvedValue({}) })
async function setup() {
  render(<MemoryRouter><OrganizationInvite organizationId="o1" onCheck={() => {}} onClose={() => {}} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Ведущий' }))
  fireEvent.change(screen.getByLabelText('Email получателя'), { target: { value: 'demo@example.test' } })
  return screen.getByRole('button', { name: 'Создать приглашение' }).closest('form')
}
it('отправляет один запрос при двойной отправке', async () => {
  let finish
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const form = await setup()
  fireEvent.submit(form); fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith({ organizationId: 'o1', email: 'demo@example.test', roleKeys: ['host'] })
  await act(async () => finish(receipt))
  expect(screen.getByLabelText('Ссылка приглашения').value).toContain('synthetic-token')
  expect(save).toHaveBeenCalledTimes(1)
})
it('сбой локального сохранения не теряет полученную ссылку и не повторяет RPC', async () => {
  create.mockResolvedValue(receipt); save.mockRejectedValue(new Error('storage failed'))
  fireEvent.submit(await setup())
  await screen.findByText(/ссылка не сохранена на устройстве/)
  expect(screen.getByLabelText('Ссылка приглашения').value).toContain('synthetic-token')
  expect(screen.queryByRole('button', { name: 'Создать приглашение' })).toBeNull()
  expect(create).toHaveBeenCalledTimes(1)
})
it('потеря ответа блокирует повтор и предлагает проверить приглашения', async () => {
  create.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = await setup(); fireEvent.submit(form)
  await screen.findByRole('button', { name: 'Проверить приглашения' })
  fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(save).not.toHaveBeenCalled()
})
it('существующее приглашение показывает понятный отказ без ложного успеха', async () => {
  create.mockRejectedValue({ code: '23505' })
  fireEvent.submit(await setup())
  await screen.findByText(/уже есть ожидающее приглашение/)
  expect(screen.queryByLabelText('Ссылка приглашения')).toBeNull()
})
