import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const card = vi.hoisted(() => vi.fn())
vi.mock('../services/peopleCatalogApi', () => ({ getParticipantProfileCard: card }))
vi.mock('../hooks/usePeopleCatalog', () => ({ usePeopleCatalog: () => ({ items: [], hasMore: false }) }))
import ParticipantProfileSearch from './ParticipantProfileSearch'
beforeEach(() => { card.mockReset() })
it('недоступный профиль не подменяется другим', async () => {
  card.mockRejectedValue({ code: '42501' })
  const change = vi.fn()
  render(<ParticipantProfileSearch actorId="u1" value="p1" onChange={change} />)
  await screen.findByText('Участник: Профиль недоступен')
  expect(change).not.toHaveBeenCalled()
})
it('позднее имя прежнего профиля не заменяет выбранное', async () => {
  let finish
  card.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce({ display_name:'Второй',can_participate:true })
  const view = render(<ParticipantProfileSearch actorId="u1" value="p1" onChange={() => {}} />)
  await waitFor(() => expect(card).toHaveBeenCalledTimes(1))
  view.rerender(<ParticipantProfileSearch actorId="u1" value="p2" onChange={() => {}} />)
  await screen.findByText('Участник: Второй')
  await act(async () => finish({ display_name:'Первый',can_participate:true }))
  expect(screen.queryByText('Участник: Первый')).toBeNull()
  expect(card.mock.calls[0][1].aborted).toBe(true)
})
