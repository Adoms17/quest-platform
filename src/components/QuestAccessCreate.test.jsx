import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const { create, save } = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }))
vi.mock('../services/questAccessApi', () => ({ createQuestAccessCredential: create }))
vi.mock('../services/localSecretLinks', () => ({ saveLocalSecretLink: save }))
import QuestAccessCreate from './QuestAccessCreate'
const receipt = { credential_id: 'c1', credential_token: 'synthetic-code' }
beforeEach(() => { create.mockReset(); save.mockReset(); save.mockResolvedValue({}) })
function setup(props = {}) {
  render(<QuestAccessCreate questId="q1" onClose={() => {}} onIssued={() => {}} onCheck={() => {}} {...props} />)
  return screen.getByRole('button', { name: 'Создать', exact: true }).closest('form')
}
it('двойная отправка создаёт один код', async () => {
  let finish
  create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const form = setup()
  fireEvent.change(screen.getByLabelText('Тип доступа'), { target: { value: 'code' } })
  fireEvent.submit(form); fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith({ questId: 'q1', kind: 'code', email: '', maxRedemptions: 1 })
  await act(async () => finish(receipt))
  expect(screen.getByLabelText('Код доступа').value).toBe('synthetic-code')
})
it('сохраняет результат в интерфейсе при отказе хранилища', async () => {
  create.mockResolvedValue(receipt); save.mockRejectedValue(new Error('storage failed'))
  const issued = vi.fn()
  fireEvent.submit(setup({ onIssued: issued }))
  await screen.findByText(/не сохранены на устройстве/)
  expect(screen.getByLabelText('Ссылка доступа').value).toContain('synthetic-code')
  expect(issued).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Создать', exact: true })).toBeNull()
})
it('не повторяет создание после потери ответа', async () => {
  create.mockRejectedValue(new TypeError('Failed to fetch'))
  const check = vi.fn(), form = setup({ onCheck: check })
  fireEvent.submit(form)
  await screen.findByRole('alert')
  fireEvent.submit(form)
  expect(create).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Проверить способы входа' }))
  expect(check).toHaveBeenCalledTimes(1)
})
it('приглашение использует email и одну активацию', async () => {
  create.mockResolvedValue(receipt)
  const form = setup()
  fireEvent.change(screen.getByLabelText('Максимум участников'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Тип доступа'), { target: { value: 'invitation' } })
  fireEvent.change(screen.getByLabelText('Email получателя'), { target: { value: 'demo@example.test' } })
  fireEvent.submit(form)
  await screen.findByLabelText('Ссылка доступа')
  expect(create).toHaveBeenCalledWith({ questId: 'q1', kind: 'invitation', email: 'demo@example.test', maxRedemptions: 1 })
})
