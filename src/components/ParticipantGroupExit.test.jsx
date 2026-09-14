import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const {remove,leave}=vi.hoisted(()=>({remove:vi.fn(),leave:vi.fn()}))
vi.mock('../services/peopleCatalogApi',()=>({removeParticipantGroupMember:remove}))
vi.mock('../services/participantGroupApi',()=>({leaveParticipantGroup:leave}))
import ParticipantGroupExit from './ParticipantGroupExit'
beforeEach(()=>{remove.mockReset();leave.mockReset()})
function setup(member={id:'p1',display_name:'Участник'}) {const refresh=vi.fn();const view=render(<ParticipantGroupExit groupId="g1" member={member} onRefresh={refresh}/>);return {...view,refresh}}
it('отмена не удаляет',()=>{setup();fireEvent.click(screen.getByText('Удалить из группы'));fireEvent.click(screen.getByText('Отмена'));expect(remove).not.toHaveBeenCalled()})
it('удаление отправляет только ID и защищено от двойной отправки',async()=>{let finish;remove.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const {refresh}=setup();fireEvent.click(screen.getByText('Удалить из группы'));const b=screen.getByText('Подтвердить действие');fireEvent.click(b);fireEvent.click(b);expect(remove).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith('g1','p1');await act(async()=>finish());expect(refresh).toHaveBeenCalledTimes(1)})
it('выход объясняет зависимые профили и вызывает отдельный RPC',async()=>{leave.mockResolvedValue();const {refresh}=setup(null);fireEvent.click(screen.getByText('Покинуть группу'));expect(screen.getByText(/все созданные вами зависимые профили/)).toBeTruthy();fireEvent.click(screen.getByText('Подтвердить действие'));await act(async()=>{});expect(leave).toHaveBeenCalledWith('g1');expect(refresh).toHaveBeenCalledTimes(1)})
it('после ошибки требует проверки состава',async()=>{remove.mockRejectedValue(new Error('network'));const {refresh}=setup();fireEvent.click(screen.getByText('Удалить из группы'));fireEvent.click(screen.getByText('Подтвердить действие'));await screen.findByRole('alert');expect(screen.queryByText('Подтвердить действие')).toBeNull();fireEvent.click(screen.getByText('Проверить состав'));expect(refresh).toHaveBeenCalledTimes(1)})
