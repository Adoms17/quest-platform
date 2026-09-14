import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ revokeParticipantSupervisor:vi.fn(),revokeMyParticipantSupervision:vi.fn(),restoreOrphanedParticipantSupervision:vi.fn() }))
vi.mock('../services/participantGroupApi', () => api)
import ParticipantSupervisorAction from './ParticipantSupervisorAction'
beforeEach(() => { Object.values(api).forEach(fn=>fn.mockReset()) })
function setup(member={id:'u1',username:'Взрослый',can_revoke:true}) {
  const refresh=vi.fn()
  const view=render(<ParticipantSupervisorAction profileId="p1" member={member} onRefresh={refresh} />)
  return {...view,refresh}
}
it('не показывает запрещённые действия',()=>{setup({id:'u1'});expect(screen.queryByRole('button')).toBeNull()})
it('отмена не вызывает RPC',()=>{setup();fireEvent.click(screen.getByText('Отозвать доступ взрослого'));fireEvent.click(screen.getByText('Отмена'));expect(api.revokeParticipantSupervisor).not.toHaveBeenCalled()})
it('отправляет один отзыв и обновляет список после ответа',async()=>{
 let finish;api.revokeParticipantSupervisor.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const {refresh}=setup();fireEvent.click(screen.getByText('Отозвать доступ взрослого'))
 const button=screen.getByText('Подтвердить действие');fireEvent.click(button);fireEvent.click(button)
 expect(api.revokeParticipantSupervisor).toHaveBeenCalledTimes(1);expect(api.revokeParticipantSupervisor).toHaveBeenCalledWith('p1','u1')
 await act(async()=>finish());expect(refresh).toHaveBeenCalledTimes(1)
})
it.each([
 [{id:'u1',can_revoke:true,is_self:true},'Отказаться от доступа к профилю','revokeMyParticipantSupervision'],
 [{id:'u1',can_restore:true,is_self:true},'Восстановить мой доступ','restoreOrphanedParticipantSupervision']
])('вызывает собственное действие без чужого ID',async(member,label,method)=>{
 api[method].mockResolvedValue();const {refresh}=setup(member)
 fireEvent.click(screen.getByText(label));fireEvent.click(screen.getByText('Подтвердить действие'))
 await act(async()=>{});expect(api[method]).toHaveBeenCalledWith('p1');expect(refresh).toHaveBeenCalledTimes(1)
})
it('после ошибки требует проверки связей',async()=>{
 api.revokeParticipantSupervisor.mockRejectedValue(new Error('network'));const {refresh}=setup()
 fireEvent.click(screen.getByText('Отозвать доступ взрослого'));fireEvent.click(screen.getByText('Подтвердить действие'))
 await screen.findByRole('alert');expect(screen.queryByText('Подтвердить действие')).toBeNull()
 fireEvent.click(screen.getByText('Проверить связи'));expect(refresh).toHaveBeenCalledTimes(1)
})
it('после ухода не обновляет другой экран',async()=>{
 let finish;api.revokeParticipantSupervisor.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const {refresh,unmount}=setup();fireEvent.click(screen.getByText('Отозвать доступ взрослого'));fireEvent.click(screen.getByText('Подтвердить действие'))
 unmount();await act(async()=>finish());expect(refresh).not.toHaveBeenCalled()
})
