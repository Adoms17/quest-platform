import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import TariffDrafts from './TariffDrafts'
const source = { id: 'source', plan_key: 'pro', version: 1, display_name: 'Pro', active_quests_limit: 5, team_members_limit: 3, trial_duration_days: 14 }
it('reuses command on uncertain retry and saves without publishing', async () => {
 const client = { rpc: vi.fn().mockResolvedValueOnce({ error: { code: 'network' } }).mockResolvedValueOnce({ data: { ...source, id: 'draft', source_version_id: 'source', plan_key: 'pro', version: 1, revision: 1 } }) }
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Подготовить черновик этой версии'))
 fireEvent.click(screen.getByText('Сохранить черновик')); await screen.findByRole('alert')
 fireEvent.click(screen.getByText('Сохранить черновик')); await screen.findByText('Черновик сохранён. Условия организаций не изменены.')
 expect(client.rpc.mock.calls[0]).toEqual(client.rpc.mock.calls[1])
 expect(client.rpc.mock.calls[0][0]).toBe('save_platform_tariff_draft')
})
it('preserves edits after revision conflict, clears them after denial', async () => {
 const client = { rpc: vi.fn().mockResolvedValueOnce({ error: { code: '40001' } }).mockResolvedValueOnce({ error: { code: '42501' } }) }
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Подготовить черновик этой версии'))
 fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Моя правка' } })
 fireEvent.click(screen.getByText('Сохранить черновик')); await screen.findByRole('alert')
 expect(screen.getByLabelText('Название')).toHaveValue('Моя правка')
 fireEvent.click(screen.getByText('Сохранить черновик')); await screen.findByText('Доступ не предоставлен или отозван. Обратитесь к владельцу платформы.')
 expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
})

it('compares saved server values and dismisses preview on form editing', async () => {
 const draft = { ...source, id: 'draft', source_version_id: 'source', plan_key: 'pro', version: 1, revision: 2, active_quests_limit: 0 }
 const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { items: [draft], next_cursor: null } }).mockResolvedValueOnce({ data: { source, draft, changes: { active_quests_limit: true } } }) }
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Загрузить черновики'))
 fireEvent.click(await screen.findByText('Pro · черновик draft · правка 2'))
 fireEvent.click(screen.getByText('Сравнить сохранённую правку'))
 await screen.findByText('5 → 0')
 expect(client.rpc).toHaveBeenLastCalledWith('preview_platform_tariff_draft', { p_id: 'draft', p_expected_revision: 2 })
 fireEvent.change(screen.getByLabelText('Открытые квесты'), { target: { value: '2' } })
 expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('hides trial input for Free and scopes the list on the server', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [], next_cursor: null } }) }
 render(<TariffDrafts client={client} source={{ ...source, plan_key: 'free', display_name: 'Free' }} />)
 fireEvent.click(screen.getByText('Подготовить черновик этой версии'))
 expect(screen.queryByLabelText('Пробный доступ, суток')).not.toBeInTheDocument()
 fireEvent.click(screen.getByText('К черновикам этого тарифа'))
 await screen.findByText('Черновиков нет.')
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_drafts', { p_source_version_id: 'source', p_after: null })
})

it('defaults description to creation time, allows editing and sends it', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ error: { code: 'network' } }) }
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Подготовить черновик этой версии'))
 expect(screen.getByLabelText('Описание черновика').value).toMatch(/^Создан /)
 fireEvent.change(screen.getByLabelText('Описание черновика'), { target: { value: 'Летняя акция' } })
 fireEvent.click(screen.getByText('Сохранить черновик')); await screen.findByRole('alert')
 expect(client.rpc.mock.calls[0][1].p_description).toBe('Летняя акция')
})
it('shows description below the draft name', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ ...source, id: 'draft', revision: 1, description: 'Больше мест в команде' }] } }) }
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Загрузить черновики'))
 expect(await screen.findByText('Больше мест в команде')).toBeInTheDocument()
})

it('shows publication status and makes published draft read-only', async () => {
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[{...source,id:'published',revision:1,is_published:true,latest_publication:{number:2,state:'scheduled',draft_revision:1}}]}})}
 render(<TariffDrafts client={client} source={source} />)
 fireEvent.click(screen.getByText('Загрузить черновики'))
 await screen.findByText('Правка 1 → Версия №2 · Запланирована')
 expect(screen.queryByText(/Зафиксирована, не включена/)).toBeNull()
 fireEvent.click(screen.getByText('Pro · черновик publishe · правка 1'))
 expect(screen.getByRole('button',{name:'Сохранить черновик'})).toBeDisabled()
})
