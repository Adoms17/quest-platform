import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import OrganizationQuests from './OrganizationQuests'
import { createAdminApi } from './api'
const page = { summary: { total: 2, open: 1, closed: 1 }, items: [{ id: 'q', title: 'Маяк', is_open: true, is_public: false, created_at: '2026-09-01' }], next_cursor: { id: 'q' } }
test('search, independent states, pagination and revoked access', async () => {
 const api = { quests: vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce({ code: '42501' }) }
 render(<OrganizationQuests api={api} organizationId="one" />)
 fireEvent.change(screen.getByLabelText('Название квеста'), { target: { value: ' Маяк ' } })
 fireEvent.click(screen.getByText('Найти квесты'))
 await screen.findByText('Маяк')
 expect(screen.getByText('Открыт · Приватный')).toBeTruthy()
 expect(api.quests).toHaveBeenCalledWith('one', 'Маяк', 'all', null)
 fireEvent.click(screen.getByText('Следующая страница квестов'))
 await screen.findByRole('alert')
 expect(api.quests).toHaveBeenLastCalledWith('one', 'Маяк', 'all', page.next_cursor)
 expect(screen.queryByText('Маяк')).toBeNull()
})
test('late response cannot expose previous organization', async () => {
 let resolve
 const api = { quests: vi.fn(() => new Promise(r => { resolve = r })) }
 const { rerender } = render(<OrganizationQuests api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Найти квесты'))
 rerender(<OrganizationQuests api={api} organizationId="two" />)
 await act(async () => resolve(page))
 expect(screen.queryByText('Маяк')).toBeNull()
})
test('empty result and retry', async () => {
 const api = { quests: vi.fn().mockRejectedValueOnce(Error('private')).mockResolvedValueOnce({ ...page, items: [], next_cursor: null }) }
 render(<OrganizationQuests api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Найти квесты'))
 fireEvent.click(await screen.findByText('Повторить загрузку квестов'))
 await screen.findByText('По выбранным условиям квестов нет.')
 expect(screen.queryByText('private')).toBeNull()
})
test('API forwards scope and filters through RPC', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ data: page }) }
 expect(await createAdminApi(client).quests('one', 'Маяк', 'open')).toBe(page)
 expect(client.rpc).toHaveBeenCalledWith('read_platform_organization_quests', { p_organization_id: 'one', p_search: 'Маяк', p_status: 'open', p_after: null })
})