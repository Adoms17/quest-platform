import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('../services/participantGroupApi', () => ({ createParticipantGroup: create }))
import ParticipantGroupCreate from './ParticipantGroupCreate'

beforeEach(() => { create.mockReset() })
const setup = () => {
  render(<MemoryRouter><ParticipantGroupCreate /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Название группы'), { target: { value: ' Семья ' } })
  return screen.getByRole('button', { name: 'Создать группу' }).closest('form')
}
it('блокирует двойную отправку создания', async () => {
  let finish
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const form = setup()
  fireEvent.submit(form); fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith('Семья')
  await act(async () => finish('new-group'))
})
it('при потере ответа блокирует повтор и ведёт к поиску группы', async () => {
  create.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = setup()
  fireEvent.submit(form)
  const link = await screen.findByRole('link', { name: 'Проверить список групп' })
  expect(link.getAttribute('href')).toBe('/participants/group?view=groups&groups=%D0%A1%D0%B5%D0%BC%D1%8C%D1%8F')
  fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Создать группу' })).toBeDisabled()
})
it('после отказа SQL сохраняет ввод и позволяет исправление', async () => {
  create.mockRejectedValue({ code: '22023', message: 'invalid participant group name' })
  fireEvent.submit(setup())
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Название группы')).toHaveValue(' Семья ')
  expect(screen.getByRole('button', { name: 'Создать группу' })).toBeEnabled()
})
