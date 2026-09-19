import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Tariffs from './Tariffs'
const plan = { id: 'version-1', plan_key: 'free', display_name: 'Free', version: 1, active_quests_limit: 0, team_members_limit: 1, trial_duration_days: 14, created_at: '2026-09-19T00:00:00Z' }
it('reads exact version and keeps zero limit distinct from unlimited', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({data:{items:[plan],next_cursor:null},error:null}) }
 render(<Tariffs client={client} />)
 fireEvent.click(screen.getByText('Загрузить каталог'))
 fireEvent.click(await screen.findByText('Free · версия 1'))
 await screen.findByRole('article')
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_catalog',{p_after:null,p_id:'version-1'})
 expect(screen.getByText('Не применяется')).toBeInTheDocument()
 expect(screen.getByText('0')).toBeInTheDocument()
})
it('clears old catalog on denied refresh and hides provider details', async () => {
 const client = { rpc: vi.fn().mockResolvedValueOnce({data:{items:[plan],next_cursor:null}}).mockResolvedValueOnce({error:{code:'42501',message:'private'}}) }
 render(<Tariffs client={client} />)
 fireEvent.click(screen.getByText('Загрузить каталог'));await screen.findByText('Free · версия 1')
 fireEvent.click(screen.getByText('Загрузить каталог'));await screen.findByRole('alert')
 expect(screen.queryByText('Free · версия 1')).not.toBeInTheDocument();expect(screen.queryByText('private')).not.toBeInTheDocument()
})
it('ignores a response after unmount', async () => {
 let resolve; const client={rpc:vi.fn().mockReturnValue(new Promise(r=>{resolve=r}))}
 const view=render(<Tariffs client={client} />);fireEvent.click(screen.getByText('Загрузить каталог'));view.unmount()
 resolve({data:{items:[plan],next_cursor:null}})
 await waitFor(()=>expect(screen.queryByText('Free · версия 1')).not.toBeInTheDocument())
})
