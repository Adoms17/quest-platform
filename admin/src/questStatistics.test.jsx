import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import QuestStatistics from './QuestStatistics'
import { createAdminApi } from './api'
const totals={unique_participants:2,started_attempts:5,finished_attempts:3,in_progress:1,stalled:1,early_finished:0,started_quests:1,active_organizations:1}
const report={from:'2026-09-01',to:'2026-09-02',grain:'day',timezone:'Europe/Moscow',measured_at:'2026-09-25T10:00:00Z',summary:totals,by_mode:[{mode:'online',...totals}],items:[{from:'2026-09-01',to:'2026-09-01',...totals},{from:'2026-09-02',to:'2026-09-02',...totals}]}
test('statistics forwards dates and grain, displays server totals and table, changes metric',async()=>{
 const api={statistics:vi.fn().mockResolvedValue(report)}
 render(<QuestStatistics api={api} organizationId="org" />)
 fireEvent.change(screen.getByLabelText('С даты'),{target:{value:'2026-09-01'}})
 fireEvent.change(screen.getByLabelText('По дату включительно'),{target:{value:'2026-09-02'}})
 fireEvent.change(screen.getByLabelText('Группировка'),{target:{value:'week'}})
 fireEvent.click(screen.getByText('Показать статистику'))
 await screen.findByText('Итоги за 01.09.2026 — 02.09.2026')
 expect(api.statistics).toHaveBeenCalledWith('2026-09-01','2026-09-02','week','org',['online','hybrid','secure_online'])
 expect(document.querySelector('.statistics-primary dd').textContent).toBe('1')
 expect(screen.queryByText('Организации с начатыми квестами')).toBeNull()
 expect(screen.getByRole('table',{name:/Показатели по/})).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Показатель на графике'),{target:{value:'finished_attempts'}})
 expect(document.querySelector('figcaption').textContent).toBe('Завершённые')
 fireEvent.change(screen.getByLabelText('Группировка'),{target:{value:'month'}})
 expect(screen.queryByRole('table',{name:/Показатели по/})).toBeNull()
})
test('platform includes organization count; denial clears old report',async()=>{
 const api={statistics:vi.fn().mockResolvedValueOnce(report).mockRejectedValueOnce({code:'42501'})}
 render(<QuestStatistics api={api} />)
 fireEvent.click(screen.getByText('Показать статистику')); await screen.findByRole('table',{name:/Показатели по/})
 expect(screen.getAllByRole('columnheader',{name:'Организации с начатыми квестами'})[0]).toBeTruthy()
 fireEvent.click(screen.getByText('Показать статистику')); await screen.findByRole('alert')
 expect(screen.queryByRole('table',{name:/Показатели по/})).toBeNull()
})
test.each(['organization','filter'])('late report ignored after %s change',async(change)=>{
 let resolve;const api={statistics:vi.fn(()=>new Promise(r=>{resolve=r}))}
 const {rerender}=render(<QuestStatistics api={api} organizationId="one" />)
 fireEvent.click(screen.getByText('Показать статистику'))
 if(change==='organization') rerender(<QuestStatistics api={api} organizationId="two" />)
 else fireEvent.change(screen.getByLabelText('Группировка'),{target:{value:'month'}})
 await act(async()=>resolve(report))
 expect(screen.queryByRole('table',{name:/Показатели по/})).toBeNull()
})
test('validation error suggests reducing intervals',async()=>{
 render(<QuestStatistics api={{statistics:vi.fn().mockRejectedValue({code:'22023'})}} />)
 fireEvent.click(screen.getByText('Показать статистику'))
 expect((await screen.findByRole('alert')).textContent).toContain('366 интервалов')
})
test('statistics RPC scope is explicit',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:report})}
 await createAdminApi(client).statistics('2026-09-01','2026-09-02','month')
 expect(client.rpc).toHaveBeenCalledWith('read_platform_quest_statistics',{p_from:'2026-09-01',p_to:'2026-09-02',p_grain:'month',p_organization_id:null,p_modes:['online','hybrid','secure_online']})
})

test('mode selection defaults to all, supports subset, clears old totals and blocks empty selection',async()=>{
 const api={statistics:vi.fn().mockResolvedValue(report)}
 render(<QuestStatistics api={api} organizationId="org" />)
 expect(screen.getAllByRole('checkbox').every(input=>input.checked)).toBe(true)
 fireEvent.click(screen.getByRole('checkbox',{name:'Hybrid',exact:true}))
 fireEvent.click(screen.getByRole('checkbox',{name:'Secure online',exact:true}))
 fireEvent.click(screen.getByText('Показать статистику'))
 await screen.findByRole('table',{name:'Итоги по режимам проверки'})
 expect(api.statistics.mock.calls[0][4]).toEqual(['online'])
 fireEvent.click(screen.getByRole('checkbox',{name:'Online',exact:true}))
 expect(screen.queryByRole('table',{name:'Итоги по режимам проверки'})).toBeNull()
 expect(screen.getByText('Показать статистику').disabled).toBe(true)
 fireEvent.click(screen.getByText('Все режимы'))
 expect(screen.getAllByRole('checkbox').every(input=>input.checked)).toBe(true)
 expect(screen.getByText('Показать статистику').disabled).toBe(false)
})
test('late response is ignored after modes change',async()=>{
 let resolve;const api={statistics:vi.fn(()=>new Promise(r=>{resolve=r}))}
 render(<QuestStatistics api={api} />)
 fireEvent.click(screen.getByText('Показать статистику'))
 fireEvent.click(screen.getByRole('checkbox',{name:'Hybrid',exact:true}))
 await act(async()=>resolve(report))
 expect(screen.queryByRole('table',{name:'Итоги по режимам проверки'})).toBeNull()
})
