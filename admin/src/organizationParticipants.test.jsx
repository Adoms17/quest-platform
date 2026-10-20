import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import OrganizationParticipants from './OrganizationParticipants'
import { createAdminApi } from './api'
const profiles = { items: [{ id: 'p', name: 'Участник', age_group: 'unknown', status: 'active' }], next_cursor: { id: 'p' } }
const groups = { items: [{ id: 'g', name: 'Группа А' }], next_cursor: null }
test('profile to group and scoped members, age unknown, reset selection', async () => {
 const api = { participants: vi.fn().mockResolvedValueOnce(profiles).mockResolvedValueOnce(groups).mockResolvedValueOnce(profiles) }
 render(<OrganizationParticipants api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Профили')); fireEvent.click(screen.getByText('Найти профили'))
 await screen.findByText('Возраст не указан')
 fireEvent.click(screen.getByText('Группы участника')); fireEvent.click(screen.getByText('Найти группы'))
 await screen.findByText('Группа А')
 expect(api.participants).toHaveBeenLastCalledWith('one', 'groups', '', null, 'p', null)
 fireEvent.click(screen.getByText('Участники группы')); fireEvent.click(screen.getByText('Найти профили'))
 await screen.findByText('Возраст не указан')
 expect(api.participants).toHaveBeenLastCalledWith('one', 'profiles', '', 'g', null, null)
 fireEvent.click(screen.getByText('Сбросить отбор'))
 expect(screen.queryByText('Возраст не указан')).toBeNull()
})
test('search, cursor, denial clears personal data and safe retry', async () => {
 const api = { participants: vi.fn().mockResolvedValueOnce(profiles).mockRejectedValueOnce({code:'42501'}).mockResolvedValueOnce({items:[],next_cursor:null}) }
 render(<OrganizationParticipants api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Профили'))
 fireEvent.change(screen.getByLabelText('Имя участника'),{target:{value:' Участник '}})
 fireEvent.click(screen.getByText('Найти профили')); await screen.findByText('Возраст не указан')
 fireEvent.click(screen.getByText('Следующая страница списка')); await screen.findByRole('alert')
 expect(api.participants).toHaveBeenLastCalledWith('one','profiles','Участник',null,null,profiles.next_cursor)
 expect(screen.queryByText('Возраст не указан')).toBeNull()
 fireEvent.click(screen.getByText('Повторить загрузку списка')); await screen.findByText('По выбранным условиям записей нет.')
})
test.each(['organization','tab'])('late response is discarded after %s change', async change => {
 let resolve
 const api = { participants: vi.fn(() => new Promise(r => { resolve=r })) }
 const {rerender} = render(<OrganizationParticipants api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Профили')); fireEvent.click(screen.getByText('Найти профили'))
 if(change==='organization') rerender(<OrganizationParticipants api={api} organizationId="two" />)
 else fireEvent.click(screen.getByText('Группы'))
 await act(async()=>resolve(profiles))
 expect(screen.queryByText('Возраст не указан')).toBeNull()
})
test('RPC explicit scope and filters', async () => {
 const client={rpc:vi.fn().mockResolvedValue({data:groups})}
 await createAdminApi(client).participants('org','groups','query',null,'profile',{id:'cursor'})
 expect(client.rpc).toHaveBeenCalledWith('read_platform_organization_participants',{p_organization_id:'org',p_kind:'groups',p_search:'query',p_group_id:null,p_profile_id:'profile',p_after:{id:'cursor'}})
})
