import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const { credential, grant } = vi.hoisted(() => ({ credential: vi.fn(), grant: vi.fn() }))
vi.mock('../services/questAccessApi', () => ({ revokeQuestAccessCredential: credential, revokeQuestAccessGrant: grant }))
import QuestAccessRevoke from './QuestAccessRevoke'
beforeEach(() => { credential.mockReset(); grant.mockReset() })
it.each(['credentials', 'grants'])('подтверждает правильный объект: %s', async kind => {
  const rpc = kind === 'credentials' ? credential : grant
  let finish
  rpc.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const refresh = vi.fn()
  render(<QuestAccessRevoke kind={kind} item={{ id: 'i1', kind: 'link', status: 'active', participant_display_name: 'Саша' }} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByText(kind === 'credentials' ? /Уже выданные права сохраняются/ : /несинхронизированные ответы не удаляются/)).toBeTruthy()
  const confirm = screen.getByRole('button', { name: 'Подтвердить отзыв' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('i1')
  await act(async () => finish({}))
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('после ошибки предлагает перечитать серверное состояние', async () => {
  credential.mockRejectedValue(new TypeError('Failed to fetch'))
  const refresh = vi.fn()
  render(<QuestAccessRevoke kind="credentials" item={{ id: 'i1', kind: 'link', status: 'active' }} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отзыв' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Подтвердить отзыв' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Проверить доступ' }))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(credential).toHaveBeenCalledTimes(1)
})
