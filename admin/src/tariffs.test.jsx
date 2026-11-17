import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Tariffs from './Tariffs'
const plan = { id: 'version-1', plan_key: 'free', display_name: 'Free', version: 1, timeline_number: 1, timeline_state: 'current', active_quests_limit: 0, team_members_limit: 1, trial_duration_days: 14, created_at: '2026-09-19T00:00:00Z' }
it('reads exact version and keeps zero limit distinct from unlimited', async () => {
 const client = { rpc: vi.fn().mockResolvedValue({data:{items:[plan],next_cursor:null},error:null}) }
 render(<Tariffs client={client} />)
 fireEvent.click(screen.getByText('Загрузить каталог'))
 fireEvent.click(await screen.findByText('Free · Версия №1'))
 await screen.findByRole('article')
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_catalog',{p_after:null,p_id:'version-1'})
 expect(screen.getByText('Не применяется')).toBeInTheDocument()
 expect(screen.getByText('0')).toBeInTheDocument()
})
it('clears old catalog on denied refresh and hides provider details', async () => {
 const client = { rpc: vi.fn().mockResolvedValueOnce({data:{items:[plan],next_cursor:null}}).mockResolvedValueOnce({error:{code:'42501',message:'private'}}) }
 render(<Tariffs client={client} />)
 fireEvent.click(screen.getByText('Загрузить каталог'));await screen.findByText('Free · Версия №1')
 fireEvent.click(screen.getByText('Загрузить каталог'));await screen.findByRole('alert')
 expect(screen.queryByText('Free · Версия №1')).not.toBeInTheDocument();expect(screen.queryByText('private')).not.toBeInTheDocument()
})
it('ignores a response after unmount', async () => {
 let resolve; const client={rpc:vi.fn().mockReturnValue(new Promise(r=>{resolve=r}))}
 const view=render(<Tariffs client={client} />);fireEvent.click(screen.getByText('Загрузить каталог'));view.unmount()
 resolve({data:{items:[plan],next_cursor:null}})
 await waitFor(()=>expect(screen.queryByText('Free · Версия №1')).not.toBeInTheDocument())
})

it('groups versions by stable plan key and distinguishes current, scheduled and revoked',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[{...plan,id:'old',timeline_number:null,timeline_state:'revoked',effective_at:'2026-01-01'}, {...plan,id:'now',timeline_number:2,timeline_state:'current',effective_at:'2026-02-01'}, {...plan,id:'future',display_name:'Free new',timeline_number:3,timeline_state:'scheduled',effective_at:'2099-01-01'}],next_cursor:null}})}
 render(<Tariffs client={client} />);fireEvent.click(screen.getByText('Загрузить каталог'))
 await screen.findByRole('region',{name:'Тариф free'})
 expect(screen.getByText('Актуальная').closest('li')).toHaveClass('tariff-version--current')
 expect(screen.getByText('Запланирована').closest('li')).toHaveClass('tariff-version--scheduled')
 expect(screen.getByText('Отозвана').closest('li')).toHaveClass('tariff-version--revoked')
 expect(client.rpc).toHaveBeenCalledWith('read_platform_tariff_versions',{p_plan_key:'free',p_after:null})
})

it('переключатель Free Pro Business запрашивает только выбранный тариф',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[],next_cursor:null}})}
 render(<Tariffs client={client} />)
 const nav=screen.getByRole('navigation',{name:'Выбор тарифа'})
 expect([...nav.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['Free','Pro','Business'])
 fireEvent.click(screen.getByRole('button',{name:'Pro',exact:true}))
 await screen.findByText('Версий нет.')
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_versions',{p_plan_key:'pro',p_after:null})
 expect(screen.getByRole('button',{name:'Pro',exact:true})).toHaveAttribute('aria-pressed','true')
})

it('opens source version and returns to the selected plan history',async()=>{
 const derived={...plan,id:'derived',plan_key:'pro',display_name:'Pro',source_version:{id:'base',display_name:'Основа',timeline_number:1}};
 const client={rpc:vi.fn().mockImplementation((name,args)=>Promise.resolve({data:{items:args.p_id==='base'?[{...plan,id:'base',plan_key:'pro',display_name:'Основа'}]:[derived],next_cursor:null}}))};
 render(<Tariffs client={client}/>);
 fireEvent.click(screen.getByRole('button',{name:'Pro',exact:true}));
 fireEvent.click(await screen.findByText('Pro · Версия №1'));
 await screen.findByRole('article');
 expect(screen.queryByRole('region',{name:'Хронология тарифа'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Основа · Версия №1'}));
 await screen.findByRole('heading',{name:'Основа · Версия №1'});
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_catalog',{p_after:null,p_id:'base'});
 fireEvent.click(screen.getByRole('button',{name:'Открыть хронологию тарифа'}));
 await screen.findByRole('navigation',{name:'Выбор тарифа'});
 expect(client.rpc).toHaveBeenLastCalledWith('read_platform_tariff_versions',{p_plan_key:'pro',p_after:null});
});

it('removes publication controls after repeated scheduled version navigation', async()=>{
 const scheduled={...plan,timeline_state:'scheduled',effective_at:'2099-01-01T00:00:00Z'};
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[scheduled],next_cursor:null}})};
 render(<Tariffs client={client}/>);
 fireEvent.click(screen.getByText('Загрузить каталог'));
 for(let i=0;i<3;i++){
  fireEvent.click(await screen.findByText('Free · Версия №1'));
  await screen.findByRole('region',{name:'Публикация тарифа'});
  fireEvent.click(screen.getByRole('button',{name:i%2?'К каталогу':'Открыть хронологию тарифа'}));
  await screen.findByRole('navigation',{name:'Выбор тарифа'});
  expect(screen.queryByRole('region',{name:'Публикация тарифа'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Отозвать публикацию…'})).toBeNull();
 }
});
