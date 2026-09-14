import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('../services/participantGroupApi', () => ({ createDependentParticipantProfile: create }))
vi.mock('../components/ParticipantGroupPicker', () => ({ default: () => null }))
import ParticipantProfileCreate from './ParticipantProfileCreate'

beforeEach(() => { create.mockReset() })
const setup = () => {
  render(<MemoryRouter><ParticipantProfileCreate session={{ user: { id: 'u1' } }} /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Имя участника'), { target: { value: ' Новый участник ' } })
  return screen.getByRole('button', { name: 'Создать профиль' }).closest('form')
}
it('не повторяет создание при двойной отправке и не назначает группу автоматически', async () => {
  let finish
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const form = setup()
  fireEvent.submit(form); fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith({ displayName: 'Новый участник', ageGroup: 'unknown', groupId: null })
  await act(async () => finish('new-profile'))
})
it('при потере подтверждения предлагает проверить список и блокирует повтор', async () => {
  create.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = setup()
  fireEvent.submit(form)
  await screen.findByRole('link', { name: 'Проверить список людей' })
  fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Создать профиль' })).toBeDisabled()
})
it('после подтверждённого серверного отказа сохраняет имя и разрешает исправление', async () => {
  create.mockRejectedValue({ code: '42501', message: 'participant group management denied' })
  const form = setup()
  fireEvent.submit(form)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('У вас нет права'))
  expect(screen.getByLabelText('Имя участника')).toHaveValue(' Новый участник ')
  expect(screen.getByRole('button', { name: 'Создать профиль' })).toBeEnabled()
})
